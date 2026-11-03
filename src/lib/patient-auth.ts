import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readPatientSessionId } from "@/lib/patient-session";

/** Cuenta de paciente que ingresó (o null). Se consulta una sola vez por request. */
export const getCurrentAccount = cache(async () => {
  const accountId = await readPatientSessionId();
  if (!accountId) return null;

  const account = await db.patientAccount.findUnique({
    where: { id: accountId },
    include: { patient: true, dependents: { include: { patient: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!account || account.blocked) return null;
  return account;
});

export type CurrentAccount = NonNullable<Awaited<ReturnType<typeof getCurrentAccount>>>;

/** Exige haber ingresado; si no, manda a la pantalla de ingreso. */
export async function requireAccount() {
  const account = await getCurrentAccount();
  if (!account) redirect("/ingresar");
  return account;
}

export type AccountPerson = {
  patientId: string;
  name: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  affiliateNumber: string | null;
  /** SELF (el titular) | CHILD | OTHER */
  relation: string;
  email: string | null;
  phone: string;
  dni: string;
};

/** Las personas para las que la cuenta puede sacar turno: el titular primero y después los familiares. */
export function accountPeople(account: CurrentAccount): AccountPerson[] {
  const person = (patient: CurrentAccount["patient"], relation: string): AccountPerson => ({
    patientId: patient.id,
    name: `${patient.firstName} ${patient.lastName}`,
    firstName: patient.firstName,
    lastName: patient.lastName,
    birthDate: patient.birthDate,
    affiliateNumber: patient.affiliateNumber,
    relation,
    email: patient.email,
    phone: patient.phone,
    dni: patient.dni,
  });
  return [person(account.patient, "SELF"), ...account.dependents.map((d) => person(d.patient, d.relation))];
}
