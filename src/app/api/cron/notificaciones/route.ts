import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processPendingNotifications } from "@/lib/notify";

/**
 * Envía los mails pendientes (confirmaciones, recordatorios, avisos de lista de espera).
 * Lo debe llamar un programador de tareas cada pocos minutos, con el encabezado
 *   Authorization: Bearer <CRON_SECRET>
 * Acepta GET (así llama Vercel Cron) y POST (GitHub Actions, cron-job.org, curl…).
 * Si CRON_SECRET no está definido, el endpoint queda deshabilitado.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const result = await processPendingNotifications();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
