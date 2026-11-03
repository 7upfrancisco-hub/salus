"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireConfigUser } from "@/lib/config-access";
import { db } from "@/lib/db";
import { failed, saved, type FormState } from "@/lib/form-state";

// Cuentas de pacientes del turnero: las gestiona la secretaría (y la administración).

const idSchema = z.string().min(1).max(40);

function refresh() {
  revalidatePath("/configuracion/cuentas");
}

/** Marca (o desmarca) la cuenta como verificada: la secretaría vio el DNI en persona. */
export async function setVerified(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireConfigUser();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("La cuenta no existe.");
  const verify = formData.get("verified") === "1";

  const account = await db.patientAccount.findUnique({ where: { id: id.data }, select: { id: true } });
  if (!account) return failed("La cuenta no existe.");

  await db.$transaction(async (tx) => {
    await tx.patientAccount.update({
      where: { id: account.id },
      data: verify ? { verifiedAt: new Date(), verifiedById: user.id } : { verifiedAt: null, verifiedById: null },
    });
    await audit({ userId: user.id, action: verify ? "ACCOUNT_VERIFIED" : "ACCOUNT_UNVERIFIED", entity: "PatientAccount", entityId: account.id }, tx);
  });
  refresh();
  return saved();
}

/** Bloquea o desbloquea una cuenta (si el paciente no es quien dice ser, o por pedido del paciente). */
export async function setBlocked(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireConfigUser();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return failed("La cuenta no existe.");
  const block = formData.get("blocked") === "1";

  const account = await db.patientAccount.findUnique({ where: { id: id.data }, select: { id: true } });
  if (!account) return failed("La cuenta no existe.");

  await db.$transaction(async (tx) => {
    await tx.patientAccount.update({ where: { id: account.id }, data: { blocked: block } });
    await audit({ userId: user.id, action: block ? "ACCOUNT_BLOCKED" : "ACCOUNT_UNBLOCKED", entity: "PatientAccount", entityId: account.id }, tx);
  });
  refresh();
  return saved();
}
