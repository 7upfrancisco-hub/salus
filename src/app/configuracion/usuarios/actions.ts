"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/config-access";
import { ROLES } from "@/lib/constants";
import { db } from "@/lib/db";
import { failed, saved, summarize, type FormState } from "@/lib/form-state";
import { fieldErrors, loginNameSchema } from "@/lib/validation";

const checkbox = z.preprocess((v) => v === "on", z.boolean());
const passwordSchema = z.string().min(10, "La contraseña debe tener al menos 10 caracteres").max(100);

const baseSchema = z.object({
  name: z.string().trim().min(3, "Ingresá el nombre").max(80),
  manageAll: checkbox,
  active: checkbox,
  professionalId: z.string().optional(),
});

const createSchema = baseSchema.extend({
  // La columna se llama email, pero guarda el nombre de ingreso: un usuario simple o un email.
  email: loginNameSchema,
  password: passwordSchema,
  role: z.enum([ROLES.ADMIN, ROLES.SECRETARY, ROLES.PROFESSIONAL], "Elegí el rol"),
});

const updateSchema = baseSchema.extend({
  id: z.string().min(1),
  newPassword: z.union([passwordSchema, z.literal("")]).optional(),
});

function refresh() {
  revalidatePath("/configuracion/usuarios");
  revalidatePath("/agenda", "layout");
}

/** Reemplaza el vínculo usuario ↔ ficha de profesional (un profesional pertenece a un solo usuario). */
async function linkProfessional(tx: Pick<typeof db, "professional">, userId: string, professionalId: string | undefined) {
  await tx.professional.updateMany({ where: { userId }, data: { userId: null } });
  if (professionalId) await tx.professional.update({ where: { id: professionalId }, data: { userId } });
}

export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));
  const data = parsed.data;
  const accessIds = formData.getAll("access").map(String);

  if (await db.user.findUnique({ where: { email: data.email }, select: { id: true } })) return failed("Ya existe un usuario con ese nombre de ingreso.");
  if (data.role === ROLES.PROFESSIONAL) {
    if (!data.professionalId) return failed("Elegí a qué profesional corresponde este usuario.");
    const taken = await db.professional.findUnique({ where: { id: data.professionalId }, select: { userId: true } });
    if (!taken) return failed("El profesional no existe.");
    if (taken.userId) return failed("Ese profesional ya tiene un usuario.");
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        manageAll: data.role === ROLES.ADMIN ? true : data.manageAll,
        active: data.active,
      },
    });
    if (data.role === ROLES.PROFESSIONAL) await linkProfessional(tx, user.id, data.professionalId);
    if (data.role === ROLES.SECRETARY && accessIds.length > 0) {
      await tx.userProfessionalAccess.createMany({ data: accessIds.map((professionalId) => ({ userId: user.id, professionalId })) });
    }
    await audit({ userId: admin.id, action: "USER_CREATED", entity: "User", entityId: user.id, details: { email: data.email, role: data.role, manageAll: data.manageAll, access: accessIds } }, tx);
  });
  refresh();
  return saved();
}

export async function updateUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));
  const data = parsed.data;
  const accessIds = formData.getAll("access").map(String);

  const target = await db.user.findUnique({ where: { id: data.id } });
  if (!target) return failed("El usuario no existe.");

  // Salvaguardas para no quedarse sin acceso.
  if (target.id === admin.id && !data.active) return failed("No podés desactivar tu propio usuario.");
  if (target.role === ROLES.ADMIN && !data.active) {
    const otherAdmins = await db.user.count({ where: { role: ROLES.ADMIN, active: true, NOT: { id: target.id } } });
    if (otherAdmins === 0) return failed("Tiene que quedar al menos un administrador activo.");
  }
  if (target.role === ROLES.PROFESSIONAL && data.professionalId) {
    const other = await db.professional.findUnique({ where: { id: data.professionalId }, select: { userId: true } });
    if (other?.userId && other.userId !== target.id) return failed("Ese profesional ya tiene otro usuario.");
  }

  const passwordHash = data.newPassword ? await bcrypt.hash(data.newPassword, 12) : null;
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        name: data.name,
        active: data.active,
        manageAll: target.role === ROLES.ADMIN ? true : data.manageAll,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });
    if (target.role === ROLES.PROFESSIONAL) await linkProfessional(tx, target.id, data.professionalId);
    if (target.role === ROLES.SECRETARY) {
      await tx.userProfessionalAccess.deleteMany({ where: { userId: target.id } });
      if (accessIds.length > 0) await tx.userProfessionalAccess.createMany({ data: accessIds.map((professionalId) => ({ userId: target.id, professionalId })) });
    }
    await audit(
      {
        userId: admin.id,
        action: passwordHash ? "USER_UPDATED_PASSWORD_RESET" : "USER_UPDATED",
        entity: "User",
        entityId: target.id,
        details: { active: data.active, manageAll: data.manageAll, access: accessIds, professionalId: data.professionalId },
      },
      tx,
    );
  });
  refresh();
  return saved();
}
