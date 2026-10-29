"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getManageableProfessionals } from "@/lib/access";
import { audit } from "@/lib/audit";
import { requireStaff } from "@/lib/auth";
import { bookAppointment, cancelAppointment, setAppointmentStatus } from "@/lib/booking";
import { APPOINTMENT_STATUS, NOTIFICATION_KIND, WAITLIST_STATUS, type AppointmentStatus } from "@/lib/constants";
import { db } from "@/lib/db";
import { fieldErrors, patientSchema } from "@/lib/validation";

export type ActionState = { ok?: boolean; error?: string };

const actorOf = (user: { id: string; role: string; manageAll: boolean }) => ({
  id: user.id,
  role: user.role,
  manageAll: user.manageAll,
});

function refreshAgenda() {
  revalidatePath("/agenda", "layout");
}

// ───────────────────────── Estados y cancelación ─────────────────────────

const statusSchema = z.enum([
  APPOINTMENT_STATUS.RESERVED,
  APPOINTMENT_STATUS.CONFIRMED,
  APPOINTMENT_STATUS.ATTENDED,
  APPOINTMENT_STATUS.NO_SHOW,
]);

export async function changeStatus(appointmentId: string, status: AppointmentStatus): Promise<ActionState> {
  const user = await requireStaff();
  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return { error: "Estado inválido." };

  const result = await setAppointmentStatus({ appointmentId, status: parsed.data, actor: actorOf(user) });
  refreshAgenda();
  return result.ok ? { ok: true } : { error: result.message };
}

export async function cancelWithReason(appointmentId: string, reason: string): Promise<ActionState> {
  const user = await requireStaff();
  const result = await cancelAppointment({ appointmentId, by: "STAFF", actor: actorOf(user), reason });
  refreshAgenda();
  return result.ok ? { ok: true } : { error: result.message };
}

// ───────────────────────── Turno dado por secretaría ─────────────────────────

export type PatientLookup = {
  found: boolean;
  patient?: {
    firstName: string;
    lastName: string;
    birthDate: string;
    email: string | null;
    phone: string;
    affiliateNumber: string | null;
  };
};

/** Busca un paciente por DNI para autocompletar el formulario. Cada consulta queda auditada. */
export async function lookupPatient(dni: string): Promise<PatientLookup> {
  const user = await requireStaff();
  const clean = dni.replace(/[.\s]/g, "");
  if (!/^\d{6,9}$/.test(clean)) return { found: false };

  const patient = await db.patient.findUnique({ where: { dni: clean } });
  if (!patient) return { found: false };

  await audit({ userId: user.id, action: "PATIENT_VIEWED", entity: "Patient", entityId: patient.id });
  return {
    found: true,
    patient: {
      firstName: patient.firstName,
      lastName: patient.lastName,
      birthDate: patient.birthDate,
      email: patient.email,
      phone: patient.phone,
      affiliateNumber: patient.affiliateNumber,
    },
  };
}

export type StaffBookingState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Hay reglas que no se cumplen: la pantalla debe pedir el motivo del override. */
  needsOverride?: boolean;
  violations?: string[];
};

const staffBookingSchema = z.object({
  professionalId: z.string().min(1),
  coverageId: z.string().min(1, "Elegí la cobertura"),
  date: z.iso.date(),
  startMinutes: z.coerce.number().int().min(0).max(1439),
  notes: z.string().trim().max(300).optional(),
  overrideReason: z.string().trim().max(300).optional(),
});

export async function createStaffAppointment(_prev: StaffBookingState, formData: FormData): Promise<StaffBookingState> {
  const user = await requireStaff();
  const raw = Object.fromEntries(formData);

  const patient = patientSchema.safeParse(raw);
  const booking = staffBookingSchema.safeParse(raw);
  if (!patient.success || !booking.success) {
    return {
      error: "Revisá los datos ingresados.",
      fieldErrors: {
        ...(booking.success ? {} : fieldErrors(booking.error)),
        ...(patient.success ? {} : fieldErrors(patient.error)),
      },
    };
  }

  const result = await bookAppointment({
    professionalId: booking.data.professionalId,
    coverageId: booking.data.coverageId,
    date: booking.data.date,
    startMinutes: booking.data.startMinutes,
    patient: patient.data,
    notes: booking.data.notes || null,
    source: "STAFF",
    actor: actorOf(user),
    override: booking.data.overrideReason ? { reason: booking.data.overrideReason } : null,
  });

  if (!result.ok) {
    return {
      error: result.message,
      needsOverride: result.code === "NEEDS_OVERRIDE" || result.code === "OVERRIDE_REASON_REQUIRED",
      violations: result.violations,
    };
  }

  refreshAgenda();
  redirect(`/agenda?profesional=${booking.data.professionalId}&fecha=${booking.data.date}`);
}

// ───────────────────────── Lista de espera ─────────────────────────

/** Especialidades de las que puede ver la lista de espera quien está logueado. */
export async function manageableSpecialtyIds(user: { id: string; role: string; manageAll: boolean }) {
  const professionals = await getManageableProfessionals(user);
  return [...new Set(professionals.map((p) => p.specialtyId))];
}

const waitlistStatusSchema = z.enum([WAITLIST_STATUS.WAITING, WAITLIST_STATUS.BOOKED, WAITLIST_STATUS.CANCELLED]);

export async function setWaitlistStatus(entryId: string, status: string): Promise<ActionState> {
  const user = await requireStaff();
  const parsed = waitlistStatusSchema.safeParse(status);
  if (!parsed.success) return { error: "Estado inválido." };

  const specialtyIds = await manageableSpecialtyIds(user);
  const entry = await db.waitlistEntry.findFirst({ where: { id: entryId, specialtyId: { in: specialtyIds } } });
  if (!entry) return { error: "No encontramos esa entrada." };

  await db.$transaction(async (tx) => {
    await tx.waitlistEntry.update({ where: { id: entry.id }, data: { status: parsed.data } });
    await audit({ userId: user.id, action: "WAITLIST_STATUS_CHANGED", entity: "WaitlistEntry", entityId: entry.id, details: { from: entry.status, to: parsed.data } }, tx);
  });
  revalidatePath("/agenda/lista-espera");
  return { ok: true };
}

/** Vuelve a avisar por mail a alguien de la lista (por ejemplo, si el aviso anterior no llegó). */
export async function renotifyWaitlist(entryId: string): Promise<ActionState> {
  const user = await requireStaff();
  const specialtyIds = await manageableSpecialtyIds(user);
  const entry = await db.waitlistEntry.findFirst({
    where: { id: entryId, specialtyId: { in: specialtyIds } },
    include: { patient: { select: { email: true } } },
  });
  if (!entry) return { error: "No encontramos esa entrada." };
  if (!entry.patient.email) return { error: "El paciente no tiene email cargado." };

  await db.$transaction(async (tx) => {
    await tx.notificationLog.create({
      data: { kind: NOTIFICATION_KIND.WAITLIST, toAddress: entry.patient.email!, scheduledFor: new Date(), waitlistEntryId: entry.id },
    });
    await tx.waitlistEntry.update({ where: { id: entry.id }, data: { status: WAITLIST_STATUS.NOTIFIED, notifiedAt: new Date() } });
    await audit({ userId: user.id, action: "WAITLIST_RENOTIFIED", entity: "WaitlistEntry", entityId: entry.id }, tx);
  });
  revalidatePath("/agenda/lista-espera");
  return { ok: true };
}
