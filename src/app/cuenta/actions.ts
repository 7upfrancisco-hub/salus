"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { addDependent, createAccount } from "@/lib/accounts";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { getCurrentAccount } from "@/lib/patient-auth";
import { createPatientSession, destroyPatientSession } from "@/lib/patient-session";
import { allowRequest, isBlocked, recordFailure } from "@/lib/rate-limit";
import { accountPasswordSchema, dependentSchema, dniSchema, fieldErrors, registerSchema } from "@/lib/validation";

// Estas funciones las llama el público: todo se vuelve a validar acá.

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES = 6;
const LOGIN_MAX_FAILURES_PER_IP = 30;

// Hash de relleno para que el tiempo de respuesta no revele si el DNI tiene cuenta.
const DUMMY_HASH = bcrypt.hashSync("salus-dummy-password", 12);

/** Valores devueltos al formulario cuando hay un error, para que React no los borre (nunca las contraseñas). */
function echo(raw: Record<string, FormDataEntryValue>) {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && key !== "website" && !/password/i.test(key)) values[key] = value;
  }
  return values;
}

export type AccountFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
};

// ───────────────────────── Ingreso ─────────────────────────

const loginSchema = z.object({ dni: dniSchema, password: z.string().min(1).max(200) });

export async function loginAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const raw = Object.fromEntries(formData);
  const values = echo(raw);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { error: "Ingresá tu DNI (solo números) y tu contraseña.", values };

  const bucket = `plogin:${parsed.data.dni}`;
  if ((await isBlocked(bucket, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS)) || (await isBlocked("plogin", LOGIN_MAX_FAILURES_PER_IP, LOGIN_WINDOW_MS))) {
    return { error: "Demasiados intentos fallidos. Esperá unos minutos y volvé a probar.", values };
  }

  const account = await db.patientAccount.findUnique({ where: { dni: parsed.data.dni } });
  const ok = await bcrypt.compare(parsed.data.password, account?.passwordHash ?? DUMMY_HASH);
  if (!account || !ok) {
    await recordFailure(bucket);
    await recordFailure("plogin");
    return { error: "DNI o contraseña incorrectos.", values };
  }
  if (account.blocked) {
    return { error: "Tu cuenta está bloqueada. Comunicate con el centro.", values };
  }

  await db.patientAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  await createPatientSession(account.id);
  redirect("/");
}

export async function logoutAccount() {
  await destroyPatientSession();
  redirect("/");
}

// ───────────────────────── Registro ─────────────────────────

export async function registerAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  // Campo trampa: las personas no lo ven ni lo completan, los robots sí.
  if (formData.get("website")) return { error: "No se pudo crear la cuenta." };
  const raw = Object.fromEntries(formData);
  const values = echo(raw);
  if (!(await allowRequest("register", 5, 60 * 60_000))) {
    return { error: "Hiciste demasiados intentos seguidos. Esperá un rato o comunicate con el centro.", values };
  }

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    // La comparación de contraseñas no corre si otro campo falló: se avisa igual para no mostrar los errores de a uno.
    if (raw.password !== raw.passwordConfirm && !errors.passwordConfirm) errors.passwordConfirm = "Las contraseñas no coinciden";
    return { error: "Revisá los datos ingresados.", fieldErrors: errors, values };
  }

  const { dni, firstName, lastName, birthDate, email, phone, password } = parsed.data;
  const result = await createAccount({ dni, firstName, lastName, birthDate, email, phone, password });
  if (!result.ok) {
    return { error: result.message, fieldErrors: result.field ? { [result.field]: result.message } : undefined, values };
  }

  await createPatientSession(result.accountId);
  redirect("/");
}

// ───────────────────────── Mi cuenta ─────────────────────────

export async function addFamilyMember(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const account = await getCurrentAccount();
  if (!account) return { error: "Tu sesión venció. Ingresá de nuevo." };
  const raw = Object.fromEntries(formData);
  const values = echo(raw);
  if (!(await allowRequest("dependent", 10, 60 * 60_000))) return { error: "Hiciste demasiados intentos seguidos. Probá más tarde.", values };

  const parsed = dependentSchema.safeParse(raw);
  if (!parsed.success) return { error: "Revisá los datos ingresados.", fieldErrors: fieldErrors(parsed.error), values };

  const result = await addDependent(account, parsed.data);
  if (!result.ok) return { error: result.message, fieldErrors: result.field ? { [result.field]: result.message } : undefined, values };
  revalidatePath("/cuenta");
  revalidatePath("/");
  return { ok: true };
}

const passwordChangeSchema = z
  .object({ current: z.string().min(1, "Ingresá tu contraseña actual"), password: accountPasswordSchema, passwordConfirm: z.string() })
  .refine((v) => v.password === v.passwordConfirm, { path: ["passwordConfirm"], message: "Las contraseñas no coinciden" });

export async function changePassword(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const account = await getCurrentAccount();
  if (!account) return { error: "Tu sesión venció. Ingresá de nuevo." };
  const parsed = passwordChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Revisá los datos ingresados.", fieldErrors: fieldErrors(parsed.error) };

  const bucket = `pchange:${account.id}`;
  if (await isBlocked(bucket, 5, LOGIN_WINDOW_MS)) return { error: "Demasiados intentos fallidos. Esperá unos minutos y volvé a probar." };
  if (!(await bcrypt.compare(parsed.data.current, account.passwordHash))) {
    await recordFailure(bucket);
    return { error: "La contraseña actual no es correcta.", fieldErrors: { current: "La contraseña actual no es correcta." } };
  }

  await db.patientAccount.update({ where: { id: account.id }, data: { passwordHash: await bcrypt.hash(parsed.data.password, 12) } });
  await audit({ action: "ACCOUNT_PASSWORD_CHANGED", entity: "PatientAccount", entityId: account.id });
  return { ok: true };
}
