import { canManageProfessional } from "@/lib/access";
import { doctorDayAgenda } from "@/lib/agenda-export";
import { buildAgendaPdf } from "@/lib/agenda-pdf";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";

/**
 * Descarga en PDF de la agenda del día:
 *   /agenda/descargar?profesional=<id>&fecha=YYYY-MM-DD
 * Solo para el personal, y solo de las agendas que cada usuario puede ver (ver lib/access.ts). Como el
 * archivo trae datos personales de salud, cada descarga queda en el registro de actividad.
 */

const text = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

const isRealDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return text(401, "Iniciá sesión para descargar la agenda.");

  const params = new URL(request.url).searchParams;
  const date = params.get("fecha") ?? "";
  if (!isRealDate(date)) return text(400, "Fecha inválida.");

  const professionalId = params.get("profesional") ?? "";
  if (!professionalId || !(await canManageProfessional(user, professionalId))) return text(403, "No tenés acceso a esa agenda.");
  const result = await doctorDayAgenda({ professionalId, date, generatedBy: user.name });
  const filename = `agenda-${date}-${slug(result.professionalName)}.pdf`;
  await audit({ userId: user.id, action: "AGENDA_DOWNLOADED", entity: "Agenda", entityId: professionalId, details: { date, turnos: result.count } });

  const bytes = await buildAgendaPdf(result.pdf);
  return new Response(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Datos de salud: que ningún intermediario ni el navegador los guarden de más.
      "Cache-Control": "private, no-store",
    },
  });
}
