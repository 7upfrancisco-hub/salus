import "server-only";
import { headers } from "next/headers";

/**
 * Límite de pedidos por IP para los formularios públicos (evita que alguien llene la agenda
 * con reservas falsas). Vive en memoria del servidor: alcanza para un solo servidor, pero cuando
 * Salus se publique con varias instancias hay que pasarlo a un almacén compartido (Redis/Upstash).
 */
const hits = new Map<string, number[]>();

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

/** Pedidos de la ventana que siguen vigentes para esa clave (y descarta los vencidos). */
function recent(key: string, windowMs: number, now: number) {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.set(key, list);
  return list;
}

function remember(key: string, windowMs: number, now: number) {
  hits.set(key, [...recent(key, windowMs, now), now]);

  // Limpieza ocasional para que el mapa no crezca sin límite.
  if (hits.size > 5000) {
    for (const [k, times] of hits) if (times.every((t) => now - t >= windowMs)) hits.delete(k);
  }
}

/** Devuelve true si el pedido está dentro del límite (y lo cuenta). */
export async function allowRequest(bucket: string, max: number, windowMs: number) {
  const key = `${bucket}:${await clientIp()}`;
  const now = Date.now();
  if (recent(key, windowMs, now).length >= max) return false;
  remember(key, windowMs, now);
  return true;
}

/**
 * Para los casos en que solo deben contar los intentos fallidos (el login): `isBlocked` consulta sin
 * contar y `recordFailure` suma uno. Así entrar bien nunca te acerca al límite.
 */
export async function isBlocked(bucket: string, max: number, windowMs: number) {
  const key = `${bucket}:${await clientIp()}`;
  return recent(key, windowMs, Date.now()).length >= max;
}

export async function recordFailure(bucket: string, windowMs: number) {
  remember(`${bucket}:${await clientIp()}`, windowMs, Date.now());
}
