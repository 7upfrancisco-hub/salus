import "server-only";

export type MailResult =
  | { ok: true; id: string | null }
  /** No hay clave de Resend configurada: no se envía nada (útil en desarrollo). */
  | { ok: false; skipped: true; error: string }
  | { ok: false; skipped: false; error: string };

/** true si hay con qué enviar mails (clave de Resend y remitente). */
export function isMailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

/**
 * Envía un mail con Resend (https://resend.com) usando su API REST.
 * Requiere RESEND_API_KEY y MAIL_FROM (un remitente de un dominio verificado en Resend,
 * por ejemplo "Salus <turnos@tudominio.com>"). Sin RESEND_API_KEY no envía nada.
 */
export async function sendEmail(message: { to: string; subject: string; html: string; text: string }): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !from) {
    return { ok: false, skipped: true, error: "Envío de mails no configurado (faltan RESEND_API_KEY y MAIL_FROM)" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok) {
      return { ok: false, skipped: false, error: body?.message ?? `Resend respondió ${response.status}` };
    }
    return { ok: true, id: body?.id ?? null };
  } catch (error) {
    return { ok: false, skipped: false, error: error instanceof Error ? error.message : "Error de red" };
  }
}
