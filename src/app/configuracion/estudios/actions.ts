"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/config-access";
import { db } from "@/lib/db";
import { failed, saved, summarize, type FormState } from "@/lib/form-state";
import { fieldErrors } from "@/lib/validation";

const checkbox = z.preprocess((v) => v === "on", z.boolean());
/** Texto opcional: vacío se guarda como "sin dato". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    // Los navegadores mandan los saltos de línea de un textarea como \r\n: se guardan siempre como \n.
    .transform((v) => v.replace(/\r\n?/g, "\n") || null);

const studySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Ingresá el nombre del estudio").max(60, "El nombre es demasiado largo"),
  description: optionalText(120),
  instructions: optionalText(600),
  sortOrder: z.coerce.number().int().min(0).max(999),
  active: checkbox,
});

/** Alta y edición de un estudio preocupacional. No se borran: se desactivan, para no perder el historial. */
export async function saveStudy(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = studySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));
  const { id, ...data } = parsed.data;

  const sameName = await db.occupationalStudy.findFirst({ where: { name: data.name, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
  if (sameName) return failed("Ya hay un estudio con ese nombre.");

  await db.$transaction(async (tx) => {
    const row = id ? await tx.occupationalStudy.update({ where: { id }, data }) : await tx.occupationalStudy.create({ data });
    await audit({ userId: user.id, action: id ? "STUDY_UPDATED" : "STUDY_CREATED", entity: "OccupationalStudy", entityId: row.id, details: data }, tx);
  });
  revalidatePath("/configuracion/estudios");
  revalidatePath("/", "layout");
  return saved();
}
