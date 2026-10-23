"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { homeFor } from "@/lib/auth";
import { isBlocked, recordFailure } from "@/lib/rate-limit";
import { createSession, destroySession } from "@/lib/session";

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES = 6;
const LOGIN_MAX_FAILURES_PER_IP = 30;

// El campo se llama "email" por historia, pero acepta un usuario simple o un email: solo se busca tal cual.
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(120),
  password: z.string().min(1),
});

/** `email` se devuelve para que el formulario no lo borre cuando hay un error (solo se vuelve a escribir la contraseña). */
export type LoginState = { error?: string; email?: string };

// Hash de relleno para que el tiempo de respuesta no revele si el mail existe.
const DUMMY_HASH = bcrypt.hashSync("salus-dummy-password", 12);

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const typedEmail = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: "Ingresá tu usuario y tu contraseña.", email: typedEmail };

  // Freno a la fuerza bruta: solo cuentan los intentos fallidos, por email y por IP en general.
  const emailBucket = `login:${parsed.data.email}`;
  if ((await isBlocked(emailBucket, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS)) || (await isBlocked("login", LOGIN_MAX_FAILURES_PER_IP, LOGIN_WINDOW_MS))) {
    return { error: "Demasiados intentos fallidos. Esperá unos minutos y volvé a probar.", email: typedEmail };
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });

  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) {
    await recordFailure(emailBucket);
    await recordFailure("login");
    await audit({
      userId: user?.id,
      action: "LOGIN_FAILED",
      entity: "User",
      entityId: user?.id,
      details: { email: parsed.data.email },
    });
    return { error: "Email o contraseña incorrectos.", email: typedEmail };
  }

  await createSession(user.id);
  await audit({ userId: user.id, action: "LOGIN", entity: "User", entityId: user.id });
  redirect(homeFor());
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
