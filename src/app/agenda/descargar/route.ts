import { canManageProfessional, getManageableProfessionals } from "@/lib/access";
import { doctorDayAgenda, occupationalDayAgenda } from "@/lib/agenda-export";
import { buildAgendaPdf } from "@/lib/agenda-pdf";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";

/**
 * Descarga en PDF de la agenda del día:
 *   /agenda/descargar?profesional=<id>&fecha=YYYY-MM-DD      la de un médico
 *   /agenda/descargar?tipo=preocupacional&fecha=YYYY-MM-DD   los preocupacionales del día
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

  let pdf;
  let filename: string;
  const generatedBy = user.name;

  if (params.get("tipo") === "preocupacional") {
    const professionals = await getManageableProfessionals(user);
    if (professionals.length === 0) return text(403, "No tenés agendas asignadas.");
    const result = await occupationalDayAgenda({ professionalIds: professionals.map((p) => p.id), date, generatedBy });
    pdf = result.pdf;
    filename = `preocupacionales-${date}.pdf`;
    await audit({ userId: user.id, action: "AGENDA_DOWNLOADED", entity: "Agenda", details: { date, tipo: "preocupacional", turnos: result.count } });
  } else {
    const professionalId = params.get("profesional") ?? "";
    if (!professionalId || !(await canManageProfessional(user, professionalId))) return text(403, "No tenés acceso a esa agenda.");
    const result = await doctorDayAgenda({ professionalId, date, generatedBy });
    pdf = result.pdf;
    filename = `agenda-${date}-${slug(result.professionalName)}.pdf`;
    await audit({ userId: user.id, action: "AGENDA_DOWNLOADED", entity: "Agenda", entityId: professionalId, details: { date, turnos: result.count } });
  }

  const bytes = await buildAgendaPdf(pdf);
  return new Response(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Datos de salud: que ningún intermediario ni el navegador los guarden de más.
      "Cache-Control": "private, no-store",
    },
  });
}
