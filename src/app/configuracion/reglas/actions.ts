"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canManageProfessional } from "@/lib/access";
import { audit } from "@/lib/audit";
import { isGlobalEditor, requireConfigUser } from "@/lib/config-access";
import { QUOTA_PERIOD, QUOTA_SCOPE } from "@/lib/constants";
import { db } from "@/lib/db";
import { failed, saved, type FormState } from "@/lib/form-state";

const WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const duration = z.number().int().min(5).max(480).refine((n) => n % 5 === 0, "múltiplo de 5").nullable();

const payloadSchema = z.object({
  target: z.string().regex(/^[ps]:.+$/, "Elegí para quién es la regla"),
  coverageId: z.string().min(1, "Elegí la cobertura"),
  active: z.boolean(),
  notes: z.string().trim().max(300).nullable(),
  firstVisitMinutes: duration,
  controlMinutes: duration,
  windows: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startMinutes: z.number().int().min(0).max(1439),
        endMinutes: z.number().int().min(1).max(1440),
      }),
    )
    .max(50),
  quotas: z
    .array(
      z.object({
        period: z.enum([QUOTA_PERIOD.DAY, QUOTA_PERIOD.WEEK, QUOTA_PERIOD.MONTH]),
        max: z.number().int().min(1).max(1000),
        scope: z.enum([QUOTA_SCOPE.PROFESSIONAL, QUOTA_SCOPE.SPECIALTY, QUOTA_SCOPE.CENTER]),
        weekdays: z.array(z.number().int().min(0).max(6)).max(7),
      }),
    )
    .max(10),
  requirements: z.array(z.string().trim().min(1).max(120)).max(15),
});

/** Guarda una regla nueva (ruleId = null) o modifica una existente, junto con sus franjas, cupos y requisitos. */
export async function saveRule(ruleId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireConfigUser();

  let json: unknown;
  try {
    json = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return failed("No se pudo leer la regla. Probá de nuevo.");
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return failed(`Revisá los datos: ${parsed.error.issues[0]?.message ?? "formato inválido"}.`);
  const data = parsed.data;

  const [kind, targetId] = [data.target[0], data.target.slice(2)];
  const global = isGlobalEditor(user);

  // Permisos sobre el destino de la regla.
  if (kind === "p") {
    if (!(await canManageProfessional(user, targetId))) return failed("No tenés acceso a esa agenda.");
  } else {
    if (!global) return failed("Las reglas de toda una especialidad las edita administración.");
    if (!(await db.specialty.findUnique({ where: { id: targetId }, select: { id: true } }))) return failed("La especialidad no existe.");
  }
  if (!(await db.coverage.findUnique({ where: { id: data.coverageId }, select: { id: true } }))) return failed("La cobertura no existe.");

  if (!global && data.quotas.some((q) => q.scope !== QUOTA_SCOPE.PROFESSIONAL)) {
    return failed("Los cupos compartidos entre profesionales los configura administración.");
  }

  const existing = ruleId
    ? await db.coverageRule.findUnique({ where: { id: ruleId }, include: { windows: true, quotas: true, requirements: true } })
    : null;
  if (ruleId && !existing) return failed("La regla ya no existe.");
  if (existing) {
    // Quien no gestiona todo el centro no puede tocar reglas ajenas ni con cupos compartidos.
    if (existing.specialtyId && !global) return failed("Las reglas de toda una especialidad las edita administración.");
    if (existing.professionalId && !(await canManageProfessional(user, existing.professionalId))) return failed("No tenés acceso a esa regla.");
    if (!global && existing.quotas.some((q) => q.scope !== QUOTA_SCOPE.PROFESSIONAL)) return failed("Esta regla tiene cupos compartidos: solo administración la puede modificar.");
  }

  // Validación de franjas.
  if (data.windows.length === 0) return failed("Agregá al menos una franja horaria: sin franjas no se ofrece ningún turno.");
  for (const w of data.windows) {
    if (w.startMinutes >= w.endMinutes) return failed(`El ${WEEKDAY[w.weekday]}: la franja termina antes de empezar.`);
  }
  for (let i = 0; i < data.windows.length; i++) {
    for (let j = i + 1; j < data.windows.length; j++) {
      const a = data.windows[i];
      const b = data.windows[j];
      if (a.weekday === b.weekday && a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
        return failed(`Hay franjas del ${WEEKDAY[a.weekday]} que se superponen.`);
      }
    }
  }

  // Una sola regla por destino y cobertura.
  const duplicate = await db.coverageRule.findFirst({
    where: {
      coverageId: data.coverageId,
      ...(kind === "p" ? { professionalId: targetId } : { specialtyId: targetId }),
      ...(ruleId ? { NOT: { id: ruleId } } : {}),
    },
    select: { id: true },
  });
  if (duplicate) return failed("Ya existe una regla para esa cobertura y ese profesional (o especialidad). Editá la que ya está.");

  const children = {
    windows: { create: data.windows },
    quotas: { create: data.quotas.map((q) => ({ ...q, weekdays: q.weekdays.length > 0 && q.weekdays.length < 7 ? [...new Set(q.weekdays)].sort().join(",") : null })) },
    requirements: { create: data.requirements.map((text, sortOrder) => ({ text, sortOrder })) },
  };
  const scalar = {
    coverageId: data.coverageId,
    active: data.active,
    notes: data.notes || null,
    firstVisitMinutes: data.firstVisitMinutes,
    controlMinutes: data.controlMinutes,
    professionalId: kind === "p" ? targetId : null,
    specialtyId: kind === "s" ? targetId : null,
  };

  const savedId = await db.$transaction(async (tx) => {
    let id = ruleId;
    if (existing && ruleId) {
      await tx.ruleWindow.deleteMany({ where: { ruleId } });
      await tx.ruleQuota.deleteMany({ where: { ruleId } });
      await tx.ruleRequirement.deleteMany({ where: { ruleId } });
      await tx.coverageRule.update({ where: { id: ruleId }, data: { ...scalar, ...children } });
    } else {
      id = (await tx.coverageRule.create({ data: { ...scalar, ...children } })).id;
    }
    await audit(
      {
        userId: user.id,
        action: existing ? "RULE_UPDATED" : "RULE_CREATED",
        entity: "CoverageRule",
        entityId: id,
        details: { before: existing, after: data },
      },
      tx,
    );
    return id!;
  });

  revalidatePath("/configuracion/reglas");
  revalidatePath("/agenda", "layout");
  if (!ruleId) redirect(`/configuracion/reglas/${savedId}`);
  return saved();
}

export async function deleteRule(ruleId: string): Promise<void> {
  const user = await requireConfigUser();
  const rule = await db.coverageRule.findUnique({ where: { id: ruleId }, include: { quotas: true } });
  if (!rule) redirect("/configuracion/reglas");

  const global = isGlobalEditor(user);
  const allowed = rule.professionalId
    ? (await canManageProfessional(user, rule.professionalId)) && (global || rule.quotas.every((q) => q.scope === QUOTA_SCOPE.PROFESSIONAL))
    : global;
  if (!allowed) redirect("/configuracion/reglas");

  await db.$transaction(async (tx) => {
    await tx.coverageRule.delete({ where: { id: ruleId } });
    await audit({ userId: user.id, action: "RULE_DELETED", entity: "CoverageRule", entityId: ruleId, details: { rule } }, tx);
  });
  revalidatePath("/configuracion/reglas");
  revalidatePath("/agenda", "layout");
  redirect("/configuracion/reglas");
}
