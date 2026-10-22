import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * Límite de pedidos por IP para los formularios públicos (evita que alguien llene la agenda
 * con reservas falsas) y freno a la fuerza bruta del login. Los pedidos se cuentan en la base
 * (tabla RateLimitHit) y no en la memoria del servidor: en Vercel cada pedido puede caer en una
 * instancia distinta y un contador en memoria nunca llegaría al límite.
 */

/** Los pedidos más viejos que esto ya no cuentan para ninguna ventana y se borran. */
const KEEP_MS = 24 * 3_600_000;
const PURGE_PROBABILITY = 0.02;

/**
 * IP del cliente, o "local" si no hay forma de saberla.
 *
 * Los encabezados que manda el propio cliente se pueden falsificar, así que solo se leen los que
 * agrega la infraestructura: en Vercel, `x-vercel-forwarded-for` (que Vercel pisa siempre). Detrás de
 * otro proxy se toma la ÚLTIMA IP de `x-forwarded-for`, la que agregó el proxy más cercano; la primera
 * la escribe el cliente. Si el despliegue tiene más de un proxy delante, ajustar acá.
 */
export async function clientIp() {
  const h = await headers();
  if (process.env.VERCEL) {
    return h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  }
  return h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
}

async function keyFor(bucket: string) {
  return `${bucket}:${await clientIp()}`;
}

/** Borra de vez en cuando los registros viejos para que la tabla no crezca sin límite. */
async function maybePurge(now: number) {
  if (Math.random() < PURGE_PROBABILITY) {
    await db.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(now - KEEP_MS) } } });
  }
}

/**
 * Devuelve true si el pedido está dentro del límite (y lo cuenta). Es una sola sentencia: inserta
 * solo si todavía hay lugar en la ventana, así no hay un "contar y después insertar" separado.
 * Dos pedidos exactamente simultáneos pueden pasar los dos; para un freno de frecuencia alcanza.
 */
export async function allowRequest(bucket: string, max: number, windowMs: number) {
  const key = await keyFor(bucket);
  const now = Date.now();
  const inserted = await db.$executeRaw`
    INSERT INTO "RateLimitHit" ("id", "key", "createdAt")
    SELECT ${randomUUID()}, ${key}, ${new Date(now)}
    WHERE (SELECT count(*) FROM "RateLimitHit" WHERE "key" = ${key} AND "createdAt" > ${new Date(now - windowMs)}) < ${max}`;
  await maybePurge(now);
  return inserted > 0;
}

/**
 * Para los casos en que solo deben contar los intentos fallidos (el login): `isBlocked` consulta sin
 * contar y `recordFailure` suma uno. Así entrar bien nunca te acerca al límite.
 */
export async function isBlocked(bucket: string, max: number, windowMs: number) {
  const key = await keyFor(bucket);
  const used = await db.rateLimitHit.count({ where: { key, createdAt: { gt: new Date(Date.now() - windowMs) } } });
  return used >= max;
}

export async function recordFailure(bucket: string) {
  const now = Date.now();
  await db.rateLimitHit.create({ data: { key: await keyFor(bucket), createdAt: new Date(now) } });
  await maybePurge(now);
}
