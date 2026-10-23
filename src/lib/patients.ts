import "server-only";
import { APPOINTMENT_STATUS, VISIT_TYPE, type VisitType } from "@/lib/constants";
import { audit } from "@/lib/audit";
import type { db } from "@/lib/db";
import type { PatientInput } from "@/lib/validation";

type Tx = Pick<typeof db, "patient" | "appointment" | "auditLog">;

export type PatientResult =
  | { ok: true; patient: { id: string; affiliateNumber: string | null }; created: boolean }
  | { ok: false; code: "DNI_MISMATCH"; message: string };

/**
 * Busca al paciente por DNI o lo crea.
 *
 * Si el DNI ya existe, la fecha de nacimiento tiene que coincidir con la registrada: es la
 * verificación mínima para que nadie pueda pisar la ficha de otra persona. Si coincide, se
 * actualizan los datos de contacto (y queda registrado en la auditoría).
 */
export async function upsertPatient(
  tx: Tx,
  data: PatientInput,
  options: { coverageId: string | null; actorId?: string | null },
): Promise<PatientResult> {
  const existing = await tx.patient.findUnique({ where: { dni: data.dni } });

  if (!existing) {
    const created = await tx.patient.create({
      data: {
        dni: data.dni,
        firstName: data.firstName,
        lastName: data.lastName,
        birthDate: data.birthDate,
        email: data.email,
        phone: data.phone,
        affiliateNumber: data.affiliateNumber || null,
        coverageId: options.coverageId,
      },
    });
    return { ok: true, patient: created, created: true };
  }

  if (existing.birthDate !== data.birthDate) {
    return {
      ok: false,
      code: "DNI_MISMATCH",
      message: "Los datos no coinciden con los registrados para ese DNI. Comunicate con el centro para continuar.",
    };
  }

  const contactChanged =
    existing.email !== data.email ||
    existing.phone !== data.phone ||
    (data.affiliateNumber && existing.affiliateNumber !== data.affiliateNumber);

  if (contactChanged) {
    const updated = await tx.patient.update({
      where: { id: existing.id },
      data: {
        email: data.email,
        phone: data.phone,
        affiliateNumber: data.affiliateNumber || existing.affiliateNumber,
      },
    });
    await audit(
      {
        userId: options.actorId,
        action: "PATIENT_CONTACT_UPDATED",
        entity: "Patient",
        entityId: existing.id,
        details: { before: { email: existing.email, phone: existing.phone, affiliateNumber: existing.affiliateNumber } },
      },
      tx,
    );
    return { ok: true, patient: updated, created: false };
  }

  return { ok: true, patient: existing, created: false };
}

/**
 * Primera vez o control. Es "control" si el paciente ya fue atendido por ese profesional, o tuvo
 * un turno con él que ya pasó sin marcarse como ausente. Un paciente nuevo es siempre "primera vez".
 */
export async function deduceVisitType(
  tx: Pick<typeof db, "appointment">,
  patientId: string | null,
  professionalId: string,
  now: Date,
): Promise<VisitType> {
  if (!patientId) return VISIT_TYPE.FIRST;

  const previous = await tx.appointment.findFirst({
    where: {
      patientId,
      professionalId,
      OR: [
        { status: APPOINTMENT_STATUS.ATTENDED },
        { status: { in: [APPOINTMENT_STATUS.RESERVED, APPOINTMENT_STATUS.CONFIRMED] }, startsAt: { lt: now } },
      ],
    },
    select: { id: true },
  });
  return previous ? VISIT_TYPE.CONTROL : VISIT_TYPE.FIRST;
}
