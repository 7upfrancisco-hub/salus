"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { bookAppointment } from "@/lib/booking";
import type { VisitType } from "@/lib/constants";
import { db } from "@/lib/db";
import { ageInYears } from "@/lib/engine/periods";
import { upsertPatient } from "@/lib/patients";
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
import { birthDateSchema, fieldErrors, patientSchema } from "@/lib/validation";

// Estas funciones las llama el turnero público (sin sesión): todo se vuelve a validar acá.

const idSchema = z.string().min(1).max(40);

// Obligatorio: si el casillero no está tildado el campo ni siquiera llega, y debe contar como error.
/** Valores que se devuelven al formulario cuando hay un error, para que React no los borre. */
function echo(raw: Record<string, FormDataEntryValue>) {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && key !== "website") values[key] = value;
  }
  return values;
}

const consentSchema = z.literal("on", { error: "Tenés que aceptar el uso de tus datos para continuar" });

export async function getSpecialties(coverageId: string): Promise<SpecialtyOption[]> {
  if (!idSchema.safeParse(coverageId).success || !(await allowRequest("browse", 120, 60_000))) return [];
  return listSpecialtiesFor(coverageId);
}

export async function getProfessionals(coverageId: string, specialtyId: string): Promise<ProfessionalOption[]> {
  if (!idSchema.safeParse(coverageId).success || !idSchema.safeParse(specialtyId).success) return [];
  if (!(await allowRequest("browse", 120, 60_000))) return [];
  return listProfessionalsFor(coverageId, specialtyId);
}

const availabilitySchema = z.object({
  coverageId: idSchema,
  specialtyId: idSchema,
  professionalId: idSchema.nullable(),
  visitType: z.enum(["FIRST", "CONTROL"]),
  birthDate: birthDateSchema.nullable().optional(),
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
  birthDate?: string | null;
}): Promise<PublicAvailability> {
  const parsed = availabilitySchema.safeParse(params);
  if (!parsed.success || !(await allowRequest("availability", 60, 60_000))) return EMPTY_AVAILABILITY;
  return searchAvailability({ ...parsed.data, includeParticularAlternative: true });
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
  coverageId: idSchema,
  professionalId: idSchema,
  date: z.iso.date(),
  startMinutes: z.coerce.number().int().min(0).max(1439),
  notes: z.string().trim().max(300).optional(),
  consent: consentSchema,
});

export async function submitBooking(_prev: BookingState, formData: FormData): Promise<BookingState> {
  // Campo trampa: las personas no lo ven ni lo completan, los robots sí.
  if (formData.get("website")) return { error: "No se pudo completar la reserva." };
  const raw = Object.fromEntries(formData);
  const values = echo(raw);
  if (!(await allowRequest("book", 8, 10 * 60_000))) {
    return { error: "Hiciste demasiados intentos seguidos. Esperá unos minutos o comunicate con el centro.", values };
  }

  const patient = patientSchema.safeParse(raw);
  const booking = bookingSchema.safeParse(raw);
  if (!patient.success || !booking.success) {
    return {
      error: "Revisá los datos ingresados.",
      fieldErrors: {
        ...(booking.success ? {} : fieldErrors(booking.error)),
        ...(patient.success ? {} : fieldErrors(patient.error)),
      },
      values,
    };
  }

  const result = await bookAppointment({
    professionalId: booking.data.professionalId,
    coverageId: booking.data.coverageId,
    date: booking.data.date,
    startMinutes: booking.data.startMinutes,
    patient: patient.data,
    notes: booking.data.notes || null,
    source: "PUBLIC",
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
  coverageId: idSchema,
  specialtyId: idSchema,
  professionalId: idSchema.optional(),
  consent: consentSchema,
});

export async function submitWaitlist(_prev: WaitlistState, formData: FormData): Promise<WaitlistState> {
  if (formData.get("website")) return { error: "No se pudo completar el pedido." };
  const raw = Object.fromEntries(formData);
  const values = echo(raw);
  if (!(await allowRequest("waitlist", 5, 10 * 60_000))) {
    return { error: "Hiciste demasiados intentos seguidos. Esperá unos minutos o comunicate con el centro.", values };
  }

  const patient = patientSchema.safeParse(raw);
  const entry = waitlistSchema.safeParse(raw);
  if (!patient.success || !entry.success) {
    return {
      error: "Revisá los datos ingresados.",
      fieldErrors: {
        ...(entry.success ? {} : fieldErrors(entry.error)),
        ...(patient.success ? {} : fieldErrors(patient.error)),
      },
      values,
    };
  }

  const specialty = await db.specialty.findUnique({ where: { id: entry.data.specialtyId } });
  const coverage = await db.coverage.findUnique({ where: { id: entry.data.coverageId } });
  if (!specialty?.active || !coverage?.active) return { error: "La especialidad o cobertura elegida no está disponible.", values };

  // La edad se calcula con la fecha de hoy del centro, no la de UTC (que de noche ya es "mañana").
  const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
  const age = ageInYears(patient.data.birthDate, todayInZone(settings?.timezone ?? "America/Argentina/Buenos_Aires"));
  if ((specialty.minAgeYears !== null && age < specialty.minAgeYears) || (specialty.maxAgeYears !== null && age > specialty.maxAgeYears)) {
    return { error: `Esta especialidad atiende pacientes de ${specialty.minAgeYears ?? 0} a ${specialty.maxAgeYears ?? "…"} años.`, values };
  }

  let professionalId: string | null = null;
  if (entry.data.professionalId) {
    const professional = await db.professional.findFirst({
      where: { id: entry.data.professionalId, specialtyId: specialty.id, active: true },
      select: { id: true },
    });
    if (!professional) return { error: "El profesional elegido no está disponible.", values };
    professionalId = professional.id;
  }

  const outcome = await db.$transaction(async (tx) => {
    const saved = await upsertPatient(tx, patient.data, { coverageId: coverage.id });
    if (!saved.ok) return saved;

    const already = await tx.waitlistEntry.findFirst({
      where: {
        patientId: saved.patient.id,
        specialtyId: specialty.id,
        coverageId: coverage.id,
        professionalId,
        status: { in: ["WAITING", "NOTIFIED"] },
      },
      select: { id: true },
    });
    if (!already) {
      await tx.waitlistEntry.create({
        data: { patientId: saved.patient.id, specialtyId: specialty.id, coverageId: coverage.id, professionalId },
      });
    }
    return saved;
  });

  if (!outcome.ok) return { error: outcome.message, values };
  return { ok: true };
}
