"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/config-access";
import { ACTIVE_STATUSES } from "@/lib/constants";
import { db } from "@/lib/db";
import { failed, saved, summarize, type FormState } from "@/lib/form-state";
import { fieldErrors } from "@/lib/validation";

const checkbox = z.preprocess((v) => v === "on", z.boolean());

const professionalSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(3, "Ingresá el nombre del profesional").max(80),
  licenseNumber: z.string().trim().max(40).optional(),
  specialtyIds: z.array(z.string().min(1)).min(1, "Elegí al menos una especialidad"),
  onlineBooking: checkbox,
  active: checkbox,
});

export async function saveProfessional(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = professionalSchema.safeParse({ ...Object.fromEntries(formData), specialtyIds: formData.getAll("specialtyIds") });
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));
  const { id, licenseNumber, specialtyIds, ...rest } = parsed.data;
  const data = { ...rest, licenseNumber: licenseNumber || null };

  if ((await db.specialty.count({ where: { id: { in: specialtyIds } } })) !== new Set(specialtyIds).size) return failed("Alguna especialidad no existe.");
  const specialties = [...new Set(specialtyIds)].map((specialtyId) => ({ id: specialtyId }));

  await db.$transaction(async (tx) => {
    const row = id
      ? await tx.professional.update({ where: { id }, data: { ...data, specialties: { set: specialties } } })
      : await tx.professional.create({ data: { ...data, specialties: { connect: specialties } } });
    await audit({ userId: user.id, action: id ? "PROFESSIONAL_UPDATED" : "PROFESSIONAL_CREATED", entity: "Professional", entityId: row.id, details: { ...data, specialtyIds } }, tx);
  });

  revalidatePath("/configuracion/profesionales");
  revalidatePath("/agenda", "layout");
  revalidatePath("/", "layout");

  // Al desactivar a alguien con turnos futuros se avisa (no se cancelan solos).
  if (id && !data.active) {
    const future = await db.appointment.count({
      where: { professionalId: id, status: { in: [...ACTIVE_STATUSES] }, startsAt: { gt: new Date() } },
    });
    if (future > 0) return saved(`Atención: quedan ${future} turno(s) futuros de este profesional. Reprogramalos o cancelalos desde la agenda.`);
  }
  return saved();
}
