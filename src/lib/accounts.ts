import "server-only";
import { ACCOUNT_MAX_ACTIVE, APPOINTMENT_STATUS, MAX_DEPENDENTS } from "@/lib/constants";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { AccountPerson, CurrentAccount } from "@/lib/patient-auth";
import type { PatientInput } from "@/lib/validation";

const DNI_MISMATCH = "Los datos no coinciden con los registrados para ese DNI. Comunicate con el centro para continuar.";

export type AccountResult = { ok: true; accountId: string } | { ok: false; message: string; field?: string };

/**
 * Crea la cuenta de un paciente.
 *
 * Si el DNI ya tiene ficha (porque se atendió o la cargó la secretaría), la fecha de nacimiento tiene que
 * coincidir. A diferencia de una reserva, acá NO se pisan los datos de contacto de una ficha existente: quien
 * se registra con el DNI de otra persona no puede redirigir a su propio mail los avisos de esa persona.
 * La cuenta nace sin verificar: la secretaría la verifica viendo el DNI en persona.
 */
export async function createAccount(data: {
  dni: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  phone: string;
}): Promise<AccountResult> {
  try {
    return await db.$transaction(async (tx) => {
      if (await tx.patientAccount.findUnique({ where: { dni: data.dni }, select: { id: true } })) {
        return { ok: false as const, field: "dni", message: "Ya hay una cuenta con ese DNI: ingresá con tu DNI." };
      }

      let patient = await tx.patient.findUnique({ where: { dni: data.dni } });
      const existingPatient = !!patient;
      if (patient && patient.birthDate !== data.birthDate) {
        return { ok: false as const, field: "birthDate", message: DNI_MISMATCH };
      }
      if (!patient) {
        patient = await tx.patient.create({
          data: { dni: data.dni, firstName: data.firstName, lastName: data.lastName, birthDate: data.birthDate, email: data.email, phone: data.phone },
        });
      } else if (!patient.email) {
        patient = await tx.patient.update({ where: { id: patient.id }, data: { email: data.email } });
      }

      const account = await tx.patientAccount.create({ data: { dni: data.dni, patientId: patient.id } });
      await audit({ action: "ACCOUNT_REGISTERED", entity: "PatientAccount", entityId: account.id, details: { dni: data.dni, existingPatient } }, tx);
      return { ok: true as const, accountId: account.id };
    });
  } catch (error) {
    // Dos registros simultáneos con el mismo DNI: gana uno y el otro choca con el índice único.
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      return { ok: false, field: "dni", message: "Ya hay una cuenta con ese DNI: ingresá con tu DNI." };
    }
    throw error;
  }
}

/** Agrega una persona a cargo (un hijo, por ejemplo). Si ya tiene ficha en el centro, la fecha de nacimiento tiene que coincidir. */
export async function addDependent(
  account: CurrentAccount,
  data: { dni: string; firstName: string; lastName: string; birthDate: string; relation: string },
): Promise<{ ok: true } | { ok: false; message: string; field?: string }> {
  if (data.dni === account.dni) return { ok: false, field: "dni", message: "Ese es tu propio DNI: ya sos la persona titular de la cuenta." };
  if (account.dependents.length >= MAX_DEPENDENTS) {
    return { ok: false, message: `Podés agregar hasta ${MAX_DEPENDENTS} personas a cargo. Para más, comunicate con el centro.` };
  }

  return db.$transaction(async (tx) => {
    let patient = await tx.patient.findUnique({ where: { dni: data.dni } });
    if (patient && patient.birthDate !== data.birthDate) return { ok: false as const, field: "birthDate", message: DNI_MISMATCH };
    if (!patient) {
      // Los avisos de un familiar le llegan al titular de la cuenta.
      patient = await tx.patient.create({
        data: {
          dni: data.dni,
          firstName: data.firstName,
          lastName: data.lastName,
          birthDate: data.birthDate,
          email: account.patient.email,
          phone: account.patient.phone,
        },
      });
    }
    await tx.accountPatient.upsert({
      where: { accountId_patientId: { accountId: account.id, patientId: patient.id } },
      update: {},
      create: { accountId: account.id, patientId: patient.id, relation: data.relation },
    });
    await audit({ action: "ACCOUNT_DEPENDENT_ADDED", entity: "PatientAccount", entityId: account.id, details: { patientId: patient.id, relation: data.relation } }, tx);
    return { ok: true as const };
  });
}

/** Datos del paciente en el formato que espera `bookAppointment`. El contacto de un familiar sin mail propio es el del titular. */
export function patientInputFor(person: AccountPerson, account: CurrentAccount, affiliateNumber?: string): PatientInput {
  return {
    dni: person.dni,
    firstName: person.firstName,
    lastName: person.lastName,
    birthDate: person.birthDate,
    email: person.email ?? account.patient.email ?? "",
    phone: person.phone || account.patient.phone,
    affiliateNumber: affiliateNumber?.trim() || person.affiliateNumber || undefined,
  };
}

/** ¿Puede esta cuenta tomar un turno más? Las cuentas sin verificar tienen menos turnos futuros a la vez. */
export async function checkAccountCapacity(account: { id: string; verifiedAt: Date | null }): Promise<{ ok: true } | { ok: false; message: string }> {
  const max = account.verifiedAt ? ACCOUNT_MAX_ACTIVE.VERIFIED : ACCOUNT_MAX_ACTIVE.UNVERIFIED;
  const active = await db.appointment.count({
    where: {
      accountId: account.id,
      status: { in: [APPOINTMENT_STATUS.RESERVED, APPOINTMENT_STATUS.CONFIRMED] },
      startsAt: { gt: new Date() },
    },
  });
  if (active < max) return { ok: true };
  return {
    ok: false,
    message: account.verifiedAt
      ? `Ya tenés ${active} turnos pendientes, que es el máximo a la vez. Cuando atiendas o cancelés alguno podés sacar otro.`
      : `Ya tenés ${active} turnos pendientes. Hasta que verifiquemos tu cuenta (presentando tu DNI en el centro) podés tener ${max} a la vez.`,
  };
}
