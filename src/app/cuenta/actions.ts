"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { addDependent, createAccount } from "@/lib/accounts";
import { db } from "@/lib/db";
import { getCurrentAccount } from "@/lib/patient-auth";
import { createPatientSession, destroyPatientSession } from "@/lib/patient-session";
import { allowRequest, isBlocked, recordFailure } from "@/lib/rate-limit";
import { dependentSchema, dniSchema, fieldErrors, registerSchema } from "@/lib/validation";

// Estas funciones las llama el público: todo se vuelve a validar acá.

// Se ingresa solo con el DNI (no hay contraseña). Como el DNI no es secreto, lo que se frena es probar DNI
// que no tienen cuenta: eso es lo que haría alguien que busca cuentas ajenas.
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_MISSES_PER_IP = 10;

/** Valores devueltos al formulario cuando hay un error, para que React no los borre. */
function echo(raw: Record<string, FormDataEntryValue>) {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && key !== "website") values[key] = value;
  }
  return values;
}

export type AccountFormState = {
  ok?: boolean;
  error?: string;
  /** El DNI no tiene cuenta: el formulario ofrece crearla. */
  noAccount?: boolean;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
};

// ───────────────────────── Ingreso ─────────────────────────

const loginSchema = z.object({ dni: dniSchema });

export async function loginAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const raw = Object.fromEntries(formData);
  const values = echo(raw);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { error: "Ingresá tu DNI (solo números, sin puntos).", values };

  if (await isBlocked("plogin", LOGIN_MAX_MISSES_PER_IP, LOGIN_WINDOW_MS)) {
    return { error: "Demasiados intentos. Esperá unos minutos y volvé a probar, o comunicate con el centro.", values };
  }

  const account = await db.patientAccount.findUnique({ where: { dni: parsed.data.dni } });
  if (!account) {
    await recordFailure("plogin");
    return { error: "No encontramos una cuenta con ese DNI.", noAccount: true, values: { ...values, dni: parsed.data.dni } };
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
  if (!parsed.success) return { error: "Revisá los datos ingresados.", fieldErrors: fieldErrors(parsed.error), values };

  const { dni, firstName, lastName, birthDate, email, phone } = parsed.data;
  const result = await createAccount({ dni, firstName, lastName, birthDate, email, phone });
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
