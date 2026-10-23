import "server-only";
import { APPOINTMENT_STATUS, WAITLIST_STATUS, type AppointmentStatus, type VisitType } from "@/lib/constants";
import { audit } from "@/lib/audit";
import { canManageProfessional } from "@/lib/access";
import { db } from "@/lib/db";
import { verificarTurno } from "@/lib/engine/engine";
import { loadEngineContext } from "@/lib/engine/load";
import { SLOT_STATUS, type SlotStatus } from "@/lib/engine/types";
import { enqueueCancellation, enqueueForNewAppointment, enqueueWaitlistMatches } from "@/lib/notify";
import { deduceVisitType, upsertPatient } from "@/lib/patients";
import { OVERRIDABLE_STATUSES, SLOT_STATUS_LABEL } from "@/lib/status-labels";
import type { PatientInput } from "@/lib/validation";

/**
 * Servicio de turnos: único lugar donde se crean, cancelan y cambian de estado.
 * Todo se valida en el servidor, dentro de una transacción, con el MISMO motor que usan las
 * pantallas (verificarTurno), así que nunca se guarda un turno que la vista no hubiera ofrecido
 * (salvo un override de secretaría, que exige motivo y queda auditado).
 */

export type Actor = { id: string; role: string; manageAll: boolean };

export type BookErrorCode =
  | "FORBIDDEN"
  | "INVALID"
  | "SLOT_UNAVAILABLE"
  | "NEEDS_OVERRIDE"
  | "OVERRIDE_REASON_REQUIRED"
  | "NOT_OVERRIDABLE"
  | "OVERBOOK_LIMIT"
  | "DNI_MISMATCH";

export type BookResult =
  | { ok: true; appointment: { id: string; manageToken: string; startsAt: Date; visitType: VisitType } }
  | { ok: false; code: BookErrorCode; message: string; violations?: SlotStatus[] };

export type BookInput = {
  professionalId: string;
  coverageId: string;
  /** Fecha local del centro, YYYY-MM-DD. */
  date: string;
  startMinutes: number;
  patient: PatientInput;
  notes?: string | null;
  source: "PUBLIC" | "STAFF";
  actor?: Actor | null;
  /** Solo para el personal: saltear reglas dejando el motivo. */
  override?: { reason: string } | null;
  /** Obligatorio si la cobertura es la de preocupacional (y no se admite en las demás): estudio y empresa. */
  occupational?: { studyId: string; company: string } | null;
};

class Abort extends Error {
  constructor(readonly result: Extract<BookResult, { ok: false }>) {
    super(result.message);
  }
}

const fail = (code: BookErrorCode, message: string, violations?: SlotStatus[]) =>
  new Abort({ ok: false, code, message, violations });

/** Clave del candado de PostgreSQL que serializa las reservas (cualquier entero fijo sirve). */
const BOOKING_LOCK_KEY = 727_001;

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (("code" in error && (error as { code?: string }).code === "P2002") || /unique constraint/i.test(String((error as Error).message)));

export async function bookAppointment(input: BookInput): Promise<BookResult> {
  const { source, actor, professionalId, coverageId, date, startMinutes } = input;

  if (source === "STAFF") {
    if (!actor || !(await canManageProfessional(actor, professionalId))) {
      return { ok: false, code: "FORBIDDEN", message: "No tenés permiso para dar turnos a este profesional." };
    }
  }

  const coverage = await db.coverage.findUnique({ where: { id: coverageId } });
  if (!coverage || !coverage.active) {
    return { ok: false, code: "INVALID", message: "La cobertura elegida no está disponible." };
  }

  // Preocupacional: lleva estudio y empresa. Las demás coberturas no (así nadie los cuela por otro camino).
  const occupational = input.occupational ?? null;
  if (coverage.isOccupational) {
    if (!occupational || occupational.company.trim().length < 2) {
      return { ok: false, code: "INVALID", message: "Para un turno preocupacional elegí el estudio e ingresá la empresa que lo solicita." };
    }
    const study = await db.occupationalStudy.findUnique({ where: { id: occupational.studyId }, select: { active: true } });
    if (!study?.active) return { ok: false, code: "INVALID", message: "El estudio elegido no está disponible." };
  } else if (occupational) {
    return { ok: false, code: "INVALID", message: "El estudio y la empresa son solo para turnos preocupacionales." };
  }

  try {
    return await db.$transaction(async (tx) => {
      // Las reservas se validan leyendo cupos y horarios ocupados y después escribiendo. Para que dos
      // pedidos simultáneos no pasen la validación a la vez, se hacen de a uno: el candado se
      // libera solo al terminar la transacción. En un centro de salud el volumen lo permite de sobra.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_KEY})`;

      const now = new Date();
      const context = await loadEngineContext({
        professionalId,
        from: date,
        to: date,
        patientBirthDate: input.patient.birthDate,
        now,
        client: tx,
      });
      if (!context) throw fail("INVALID", "El profesional no está disponible.");

      const existing = await tx.patient.findUnique({ where: { dni: input.patient.dni }, select: { id: true, birthDate: true } });
      if (existing && existing.birthDate !== input.patient.birthDate) {
        throw fail("DNI_MISMATCH", "Los datos no coinciden con los registrados para ese DNI. Comunicate con el centro para continuar.");
      }

      const visitType = await deduceVisitType(tx, existing?.id ?? null, professionalId, now);
      const engineInput = context.inputFor({ coverageId, visitType, audience: source === "STAFF" ? "staff" : "patient" });
      const slot = verificarTurno(engineInput, date, startMinutes);
      if (!slot) throw fail("SLOT_UNAVAILABLE", "Ese horario no existe en la agenda del profesional.");

      const violations = slot.violations;
      let overrideReason: string | null = null;

      if (violations.length > 0) {
        if (source === "PUBLIC") {
          throw fail("SLOT_UNAVAILABLE", "Ese horario ya no está disponible. Elegí otro, por favor.", violations);
        }
        if (!input.override) {
          throw fail("NEEDS_OVERRIDE", `Este horario no cumple las reglas: ${violations.map((v) => SLOT_STATUS_LABEL[v]).join("; ")}.`, violations);
        }
        overrideReason = input.override.reason.trim();
        if (overrideReason.length < 5) {
          throw fail("OVERRIDE_REASON_REQUIRED", "Para saltear una regla tenés que escribir el motivo (mínimo 5 caracteres).", violations);
        }
        const blocking = violations.filter((v) => !OVERRIDABLE_STATUSES.includes(v));
        if (blocking.length > 0) {
          throw fail(
            "NOT_OVERRIDABLE",
            `No se puede dar este turno: ${blocking.map((v) => SLOT_STATUS_LABEL[v]).join("; ")}. Se corrige desde la configuración, no con un sobreturno.`,
            violations,
          );
        }

        // Si el día tiene un límite de sobreturnos habilitados, se respeta.
        if (violations.includes(SLOT_STATUS.OCCUPIED)) {
          const allowance = await tx.overbookAllowance.findUnique({
            where: { professionalId_date: { professionalId, date } },
          });
          if (allowance) {
            const used = await tx.appointment.count({
              where: {
                professionalId,
                localDate: date,
                isOverride: true,
                overrideRules: { contains: SLOT_STATUS.OCCUPIED },
                status: { not: APPOINTMENT_STATUS.CANCELLED },
              },
            });
            if (used >= allowance.maxExtra) {
              throw fail("OVERBOOK_LIMIT", `Ese día ya se dieron los ${allowance.maxExtra} sobreturnos habilitados.`, violations);
            }
          }
        }
      }

      const patientResult = await upsertPatient(tx, input.patient, { coverageId: coverage.isOccupational ? null : coverageId, actorId: actor?.id });
      if (!patientResult.ok) throw fail(patientResult.code, patientResult.message);

      // Quien consigue turno deja de esperar uno: si no, seguiría figurando en la lista (y podría
      // recibir avisos de turnos liberados que ya no necesita).
      await tx.waitlistEntry.updateMany({
        where: {
          patientId: patientResult.patient.id,
          specialtyId: context.professional.specialtyId,
          coverageId,
          status: { in: [WAITLIST_STATUS.WAITING, WAITLIST_STATUS.NOTIFIED] },
          OR: [{ professionalId: null }, { professionalId }],
        },
        data: { status: WAITLIST_STATUS.BOOKED },
      });

      const appointment = await tx.appointment.create({
        data: {
          professionalId,
          coverageId,
          patientId: patientResult.patient.id,
          officeId: slot.officeId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          localDate: date,
          status: source === "STAFF" ? APPOINTMENT_STATUS.CONFIRMED : APPOINTMENT_STATUS.RESERVED,
          visitType,
          source,
          affiliateNumber: input.patient.affiliateNumber || patientResult.patient.affiliateNumber,
          notes: input.notes ?? null,
          isOverride: violations.length > 0,
          overrideReason,
          overrideRules: violations.length > 0 ? JSON.stringify(violations) : null,
          studyId: occupational?.studyId ?? null,
          company: occupational?.company.trim() ?? null,
          createdById: actor?.id ?? null,
        },
      });

      await enqueueForNewAppointment(tx, appointment, input.patient.email, context.settings.reminderHoursBefore);

      await audit(
        {
          userId: actor?.id,
          action: violations.length > 0 ? "APPOINTMENT_CREATED_OVERRIDE" : source === "STAFF" ? "APPOINTMENT_CREATED" : "APPOINTMENT_CREATED_ONLINE",
          entity: "Appointment",
          entityId: appointment.id,
          details: { professionalId, coverageId, date, startMinutes, violations, overrideReason, ...(occupational ? { studyId: occupational.studyId } : {}) },
        },
        tx,
      );

      return {
        ok: true as const,
        appointment: { id: appointment.id, manageToken: appointment.manageToken, startsAt: appointment.startsAt, visitType: visitType as VisitType },
      };
    }, { maxWait: 15_000, timeout: 20_000 });
  } catch (error) {
    if (error instanceof Abort) return error.result;
    if (isUniqueViolation(error)) {
      return { ok: false, code: "SLOT_UNAVAILABLE", message: "Alguien acaba de reservar ese horario. Elegí otro, por favor." };
    }
    throw error;
  }
}

// ───────────────────────── Cancelar ─────────────────────────

export type CancelInput = {
  appointmentId?: string;
  token?: string;
  by: "PATIENT" | "STAFF";
  actor?: Actor | null;
  reason?: string | null;
};
export type SimpleResult = { ok: true } | { ok: false; message: string };

export async function cancelAppointment(input: CancelInput): Promise<SimpleResult> {
  const appointment = await db.appointment.findFirst({
    where: input.token ? { manageToken: input.token } : { id: input.appointmentId ?? "" },
    include: { patient: { select: { email: true } }, professional: { select: { specialtyId: true } } },
  });
  if (!appointment) return { ok: false, message: "No encontramos el turno." };

  if (input.by === "STAFF") {
    if (!input.actor || !(await canManageProfessional(input.actor, appointment.professionalId))) {
      return { ok: false, message: "No tenés permiso para cancelar este turno." };
    }
    if (!input.reason || input.reason.trim().length < 3) {
      return { ok: false, message: "Escribí el motivo de la cancelación." };
    }
  }

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) return { ok: true };
  if (appointment.status === APPOINTMENT_STATUS.ATTENDED || appointment.status === APPOINTMENT_STATUS.NO_SHOW) {
    return { ok: false, message: "Este turno ya fue atendido o marcado como ausente, no se puede cancelar." };
  }

  if (input.by === "PATIENT") {
    const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
    const limitHours = settings?.cancelLimitHours ?? 12;
    if (appointment.startsAt.getTime() - Date.now() < limitHours * 3_600_000) {
      return {
        ok: false,
        message: `Solo se puede cancelar online hasta ${limitHours} horas antes del turno. Comunicate con el centro.`,
      };
    }
  }

  await db.$transaction(async (tx) => {
    // El cambio se hace solo si el turno sigue activo: si dos personas cancelan a la vez (o lo
    // marcan atendido en ese instante), solo una lo logra y no se manda el aviso dos veces.
    const changed = await tx.appointment.updateMany({
      where: { id: appointment.id, status: { in: [APPOINTMENT_STATUS.RESERVED, APPOINTMENT_STATUS.CONFIRMED] } },
      data: {
        status: APPOINTMENT_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: input.reason?.trim() || null,
        cancelledById: input.by === "STAFF" ? (input.actor?.id ?? null) : null,
      },
    });
    if (changed.count === 0) return;
    await enqueueCancellation(tx, appointment.id, appointment.patient.email);
    await enqueueWaitlistMatches(tx, {
      professionalId: appointment.professionalId,
      specialtyId: appointment.professional.specialtyId,
      coverageId: appointment.coverageId,
      startsAt: appointment.startsAt,
    });
    await audit(
      {
        userId: input.actor?.id,
        action: input.by === "STAFF" ? "APPOINTMENT_CANCELLED" : "APPOINTMENT_CANCELLED_BY_PATIENT",
        entity: "Appointment",
        entityId: appointment.id,
        details: { reason: input.reason ?? null },
      },
      tx,
    );
  });

  return { ok: true };
}

// ───────────────────────── Cambios de estado ─────────────────────────

/** Estados a los que se puede pasar desde cada uno (cancelar tiene su propio flujo con motivo). */
const TRANSITIONS: Record<string, AppointmentStatus[]> = {
  [APPOINTMENT_STATUS.RESERVED]: [APPOINTMENT_STATUS.CONFIRMED, APPOINTMENT_STATUS.ATTENDED, APPOINTMENT_STATUS.NO_SHOW],
  [APPOINTMENT_STATUS.CONFIRMED]: [APPOINTMENT_STATUS.ATTENDED, APPOINTMENT_STATUS.NO_SHOW],
  // Corrección de un error de carga.
  [APPOINTMENT_STATUS.ATTENDED]: [APPOINTMENT_STATUS.CONFIRMED],
  [APPOINTMENT_STATUS.NO_SHOW]: [APPOINTMENT_STATUS.CONFIRMED],
};

export function allowedTransitions(status: string) {
  return TRANSITIONS[status] ?? [];
}

export async function setAppointmentStatus(input: {
  appointmentId: string;
  status: AppointmentStatus;
  actor: Actor;
}): Promise<SimpleResult> {
  const appointment = await db.appointment.findUnique({ where: { id: input.appointmentId } });
  if (!appointment) return { ok: false, message: "No encontramos el turno." };
  if (!(await canManageProfessional(input.actor, appointment.professionalId))) {
    return { ok: false, message: "No tenés permiso para modificar este turno." };
  }
  if (!allowedTransitions(appointment.status).includes(input.status)) {
    return { ok: false, message: "Ese cambio de estado no está permitido." };
  }
  const markingAttendance = input.status === APPOINTMENT_STATUS.ATTENDED || input.status === APPOINTMENT_STATUS.NO_SHOW;
  if (markingAttendance && appointment.startsAt > new Date()) {
    return { ok: false, message: "Todavía no llegó la hora del turno." };
  }

  await db.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id: appointment.id }, data: { status: input.status } });
    await audit(
      {
        userId: input.actor.id,
        action: "APPOINTMENT_STATUS_CHANGED",
        entity: "Appointment",
        entityId: appointment.id,
        details: { from: appointment.status, to: input.status },
      },
      tx,
    );
  });
  return { ok: true };
}

/** El paciente confirma su asistencia desde el link del mail. */
export async function confirmByPatient(token: string): Promise<SimpleResult> {
  const result = await db.appointment.updateMany({
    where: { manageToken: token, status: APPOINTMENT_STATUS.RESERVED, startsAt: { gt: new Date() } },
    data: { status: APPOINTMENT_STATUS.CONFIRMED },
  });
  return result.count > 0 ? { ok: true } : { ok: false, message: "No se pudo confirmar el turno." };
}

