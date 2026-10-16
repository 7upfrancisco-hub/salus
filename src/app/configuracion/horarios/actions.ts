"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageProfessional } from "@/lib/access";
import { audit } from "@/lib/audit";
import { requireConfigUser } from "@/lib/config-access";
import { db } from "@/lib/db";
import { failed, saved, type FormState } from "@/lib/form-state";
import { countAppointmentsOutsideAgenda } from "@/lib/impact";

const blockSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinutes: z.number().int().min(0).max(1439),
  endMinutes: z.number().int().min(1).max(1440),
  slotMinutes: z.number().int().min(5).max(240),
  officeId: z.string().min(1).nullable(),
  validFrom: z.iso.date().nullable(),
  validTo: z.iso.date().nullable(),
});

const WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export async function saveAgenda(professionalId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireConfigUser();
  if (!(await canManageProfessional(user, professionalId))) return failed("No tenés acceso a esa agenda.");

  let json: unknown;
  try {
    json = JSON.parse(String(formData.get("blocks") ?? "[]"));
  } catch {
    return failed("No se pudo leer el horario. Probá de nuevo.");
  }
  const parsed = z.array(blockSchema).safeParse(json);
  if (!parsed.success) return failed("Hay horarios con datos inválidos.");
  const blocks = parsed.data;

  for (const b of blocks) {
    const day = WEEKDAY[b.weekday];
    if (b.startMinutes >= b.endMinutes) return failed(`El ${day}: la hora de inicio debe ser anterior a la de fin.`);
    if (b.slotMinutes % 5 !== 0) return failed(`El ${day}: la duración del turno debe ser múltiplo de 5 minutos.`);
    if (b.endMinutes - b.startMinutes < b.slotMinutes) return failed(`El ${day}: el bloque es más corto que un turno.`);
    if (b.validFrom && b.validTo && b.validFrom > b.validTo) return failed(`El ${day}: la vigencia termina antes de empezar.`);
  }

  // Dos bloques del mismo día no pueden pisarse si rigen en las mismas fechas.
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      const sameDay = a.weekday === b.weekday;
      const timeOverlap = a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
      const validityOverlap = (a.validFrom ?? "0000-00-00") <= (b.validTo ?? "9999-99-99") && (b.validFrom ?? "0000-00-00") <= (a.validTo ?? "9999-99-99");
      if (sameDay && timeOverlap && validityOverlap) return failed(`Hay bloques del ${WEEKDAY[a.weekday]} que se superponen.`);
    }
  }

  const offices = await db.office.findMany({ where: { active: true }, select: { id: true } });
  const officeIds = new Set(offices.map((o) => o.id));
  if (blocks.some((b) => b.officeId && !officeIds.has(b.officeId))) return failed("Hay un consultorio que ya no existe.");

  const before = await db.agendaBlock.findMany({ where: { professionalId } });
  await db.$transaction(async (tx) => {
    await tx.agendaBlock.deleteMany({ where: { professionalId } });
    await tx.agendaBlock.createMany({ data: blocks.map((b) => ({ ...b, professionalId })) });
    await audit(
      { userId: user.id, action: "AGENDA_UPDATED", entity: "Professional", entityId: professionalId, details: { before, after: blocks } },
      tx,
    );
  });

  const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
  const outside = await countAppointmentsOutsideAgenda(professionalId, settings?.timezone ?? "America/Argentina/Buenos_Aires");

  revalidatePath("/configuracion/horarios");
  revalidatePath("/agenda", "layout");
  return saved(outside > 0 ? `Atención: ${outside} turno(s) ya dados quedan fuera del nuevo horario. Revisalos en la agenda.` : undefined);
}
