import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

// Sesión de las cuentas de pacientes. Es una cookie distinta de la del personal y el token lleva
// una audiencia propia: aunque comparten la clave, un token de un lado no sirve del otro.
const COOKIE_NAME = "salus_patient";
const AUDIENCE = "patient";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function getKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("Falta la variable de entorno SESSION_SECRET");
  }
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET es demasiado corto: usá al menos 32 caracteres aleatorios");
  }
  return new TextEncoder().encode(secret);
}

export async function createPatientSession(accountId: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(accountId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getKey());

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readPatientSessionId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), { audience: AUDIENCE });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export async function destroyPatientSession() {
  (await cookies()).delete(COOKIE_NAME);
}
