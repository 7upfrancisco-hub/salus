import { NextResponse } from "next/server";
import { processPendingNotifications } from "@/lib/notify";

/**
 * Envía los mails pendientes (confirmaciones, recordatorios, avisos de lista de espera).
 * Lo debe llamar un programador de tareas cada pocos minutos, con el encabezado
 *   Authorization: Bearer <CRON_SECRET>
 * Si CRON_SECRET no está definido, el endpoint queda deshabilitado.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const result = await processPendingNotifications();
  return NextResponse.json(result);
}
