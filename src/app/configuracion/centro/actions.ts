"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/config-access";
import { db } from "@/lib/db";
import { failed, saved, summarize, type FormState } from "@/lib/form-state";
import { fieldErrors } from "@/lib/validation";

const validTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat("es-AR", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const settingsSchema = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre del centro").max(60),
  timezone: z.string().trim().refine(validTimezone, "Zona horaria inválida (ej. America/Argentina/Buenos_Aires)"),
  bookingHorizonDays: z.coerce.number("Indicá el plazo de reserva").int().min(1, "El plazo mínimo es 1 día").max(365),
  minNoticeHours: z.coerce.number("Indicá la anticipación mínima").int().min(0).max(720),
  cancelLimitHours: z.coerce.number("Indicá el límite de cancelación").int().min(0).max(720),
  reminderHoursBefore: z.coerce.number("Indicá cuándo enviar el recordatorio").int().min(1, "Mínimo 1 hora").max(168),
});

export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));

  await db.$transaction(async (tx) => {
    const before = await tx.centerSettings.findUnique({ where: { id: 1 } });
    await tx.centerSettings.upsert({ where: { id: 1 }, update: parsed.data, create: { id: 1, ...parsed.data } });
    await audit({ userId: user.id, action: "SETTINGS_UPDATED", entity: "CenterSettings", entityId: "1", details: { before, after: parsed.data } }, tx);
  });
  revalidatePath("/", "layout");
  return saved();
}
