"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { checkAccountCapacity, patientInputFor } from "@/lib/accounts";
import { bookAppointment } from "@/lib/booking";
import type { VisitType } from "@/lib/constants";
import { db } from "@/lib/db";
import { ageInYears } from "@/lib/engine/periods";
import { accountPeople, getCurrentAccount } from "@/lib/patient-auth";
import {
  listProfessionalsFor,
  listSpecialtiesFor,
  searchAvailability,
  type ProfessionalOption,
  type PublicAvailability,
  type SpecialtyOption,
} from "@/lib/public";
import { allowRequest } from "@/lib/rate-limit";
import { todayInZone } from "@/lib/time";
import { fieldErrors } from "@/lib/validation";

// Estas funciones las llama el turnero público. Hay que haber ingresado con una cuenta de paciente: todo se
// vuelve a validar acá (ocultar la pantalla no alcanza) y el paciente sale siempre de la cuenta, nunca del formulario.

const idSchema = z.string().min(1).max(40);

const SESSION_EXPIRED = "Tu sesión venció. Ingresá de nuevo para continuar.";

/** Valores que se devuelven al formulario cuando hay un error, para que React no los borre. */
function echo(raw: Record<string, FormDataEntryValue>) {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && key !== "website") values[key] = value;
  }
  return values;
}

/** La cuenta que ingresó y la persona (ella misma o un familiar) para la que se pide el turno. */
async function accountAndPerson(patientId: string) {
  const account = await getCurrentAccount();
  if (!account) return null;
  const person = accountPeople(account).find((p) => p.patientId === patientId);
  return person ? { account, person } : null;
}

export async function getSpecialties(coverageId: string): Promise<SpecialtyOption[]> {
  if (!idSchema.safeParse(coverageId).success || !(await getCurrentAccount()) || !(await allowRequest("browse", 120, 60_000))) return [];
  return listSpecialtiesFor(coverageId);
}

export async function getProfessionals(coverageId: string, specialtyId: string): Promise<ProfessionalOption[]> {
  if (!idSchema.safeParse(coverageId).success || !idSchema.safeParse(specialtyId).success) return [];
  if (!(await getCurrentAccount()) || !(await allowRequest("browse", 120, 60_000))) return [];
  return listProfessionalsFor(coverageId, specialtyId);
}

const availabilitySchema = z.object({
  coverageId: idSchema,
  specialtyId: idSchema,
  professionalId: idSchema.nullable(),
  visitType: z.enum(["FIRST", "CONTROL"]),
  patientId: idSchema,
});

const EMPTY_AVAILABILITY: PublicAvailability = {
  days: [],
  requirementsByProfessional: {},
  askVisitType: false,
  particularAlternative: null,
};

export async function getAvailability(params: {
  coverageId: string;
  specialtyId: string;
  professionalId: string | null;
  visitType: VisitType;
  /** Persona para la que se busca turno: de ella sale la fecha de nacimiento que se usa para el límite de edad. */
  patientId: string;
}): Promise<PublicAvailability> {
  const parsed = availabilitySchema.safeParse(params);
  if (!parsed.success || !(await allowRequest("availability", 60, 60_000))) return EMPTY_AVAILABILITY;
  const who = await accountAndPerson(parsed.data.patientId);
  if (!who) return EMPTY_AVAILABILITY;
  const { coverageId, specialtyId, professionalId, visitType } = parsed.data;
  return searchAvailability({ coverageId, specialtyId, professionalId, visitType, birthDate: who.person.birthDate, includeParticularAlternative: true });
}

// ───────────────────────── Reservar ─────────────────────────

export type BookingState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** El horario elegido se ocupó: la pantalla debe volver a buscar horarios. */
  slotTaken?: boolean;
  values?: Record<string, string>;
};

const bookingSchema = z.object({
  patientId: idSchema,
  coverageId: idSchema,
  professionalId: idSchema,
  date: z.iso.date(),
  startMinutes: z.coerce.number().int().min(0).max(1439),
  specialtyId: idSchema.optional(),
  notes: z.string().trim().max(300).optional(),
  affiliateNumber: z.string().trim().max(40).optional(),
});

export async function submitBooking(_prev: BookingState, formData: FormData): Promise<BookingState> {
  const raw = Object.fromEntries(formData);
  const values = echo(raw);
  if (!(await allowRequest("book", 8, 10 * 60_000))) {
    return { error: "Hiciste demasiados intentos seguidos. Esperá unos minutos o comunicate con el centro.", values };
  }

  const booking = bookingSchema.safeParse(raw);
  if (!booking.success) return { error: "Revisá los datos ingresados.", fieldErrors: fieldErrors(booking.error), values };

  const who = await accountAndPerson(booking.data.patientId);
  if (!who) return { error: SESSION_EXPIRED, values };

  const capacity = await checkAccountCapacity(who.account);
  if (!capacity.ok) return { error: capacity.message, values };

  const result = await bookAppointment({
    professionalId: booking.data.professionalId,
    coverageId: booking.data.coverageId,
    date: booking.data.date,
    startMinutes: booking.data.startMinutes,
    patient: patientInputFor(who.person, who.account, booking.data.affiliateNumber),
    notes: booking.data.notes || null,
    source: "PUBLIC",
    specialtyId: booking.data.specialtyId ?? null,
    accountId: who.account.id,
  });

  if (!result.ok) {
    return { error: result.message, slotTaken: result.code === "SLOT_UNAVAILABLE", values };
  }
  redirect(`/turno/${result.appointment.manageToken}`);
}

// ───────────────────────── Lista de espera ─────────────────────────

export type WaitlistState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
};

const waitlistSchema = z.object({
  patientId: idSchema,
  coverageId: idSchema,
  specialtyId: idSchema,
  professionalId: idSchema.optional(),
});

export async function submitWaitlist(_prev: WaitlistState, formData: FormData): Promise<WaitlistState> {
  const raw = Object.fromEntries(formData);
  const values = echo(raw);
  if (!(await allowRequest("waitlist", 5, 10 * 60_000))) {
    return { error: "Hiciste demasiados intentos seguidos. Esperá unos minutos o comunicate con el centro.", values };
  }

  const entry = waitlistSchema.safeParse(raw);
  if (!entry.success) return { error: "Revisá los datos ingresados.", fieldErrors: fieldErrors(entry.error), values };

  const who = await accountAndPerson(entry.data.patientId);
  if (!who) return { error: SESSION_EXPIRED, values };

  const specialty = await db.specialty.findUnique({ where: { id: entry.data.specialtyId } });
  const coverage = await db.coverage.findUnique({ where: { id: entry.data.coverageId } });
  if (!specialty?.active || !coverage?.active) return { error: "La especialidad o cobertura elegida no está disponible.", values };

  // La edad se calcula con la fecha de hoy del centro, no la de UTC (que de noche ya es "mañana").
  const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
  const age = ageInYears(who.person.birthDate, todayInZone(settings?.timezone ?? "America/Argentina/Buenos_Aires"));
  if ((specialty.minAgeYears !== null && age < specialty.minAgeYears) || (specialty.maxAgeYears !== null && age > specialty.maxAgeYears)) {
    return { error: `Esta especialidad atiende pacientes de ${specialty.minAgeYears ?? 0} a ${specialty.maxAgeYears ?? "…"} años.`, values };
  }

  let professionalId: string | null = null;
  if (entry.data.professionalId) {
    const professional = await db.professional.findFirst({
      where: { id: entry.data.professionalId, specialties: { some: { id: specialty.id } }, active: true },
      select: { id: true },
    });
    if (!professional) return { error: "El profesional elegido no está disponible.", values };
    professionalId = professional.id;
  }

  const already = await db.waitlistEntry.findFirst({
    where: {
      patientId: who.person.patientId,
      specialtyId: specialty.id,
      coverageId: coverage.id,
      professionalId,
      status: { in: ["WAITING", "NOTIFIED"] },
    },
    select: { id: true },
  });
  if (!already) {
    await db.waitlistEntry.create({
      data: { patientId: who.person.patientId, specialtyId: specialty.id, coverageId: coverage.id, professionalId },
    });
  }
  return { ok: true };
}
