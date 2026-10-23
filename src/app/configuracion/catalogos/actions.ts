"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/config-access";
import { db } from "@/lib/db";
import { failed, saved, summarize, type FormState } from "@/lib/form-state";
import { fieldErrors } from "@/lib/validation";

function refresh() {
  revalidatePath("/configuracion/catalogos");
  revalidatePath("/", "layout");
}

const checkbox = z.preprocess((v) => v === "on", z.boolean());
const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(min).max(max).nullable());

// ───────────────────────── Coberturas ─────────────────────────

const coverageSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Ingresá el nombre de la cobertura").max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido"),
  isParticular: checkbox,
  active: checkbox,
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export async function saveCoverage(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = coverageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));
  const { id, ...data } = parsed.data;

  // «Preocupacional» es la cobertura de los turnos preocupacionales: el sistema la reconoce por su marca,
  // así que no se renombra ni se la hace pasar por atención particular (solo color, orden y si está activa).
  const existing = id ? await db.coverage.findUnique({ where: { id }, select: { isOccupational: true, name: true } }) : null;
  if (existing?.isOccupational) {
    data.name = existing.name;
    data.isParticular = false;
  }

  const sameName = await db.coverage.findFirst({ where: { name: data.name, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
  if (sameName) return failed("Ya hay una cobertura con ese nombre.");
  if (data.isParticular) {
    const other = await db.coverage.findFirst({ where: { isParticular: true, ...(id ? { NOT: { id } } : {}) }, select: { name: true } });
    if (other) return failed(`«${other.name}» ya está marcada como atención particular: solo puede haber una.`);
  }

  await db.$transaction(async (tx) => {
    const row = id ? await tx.coverage.update({ where: { id }, data }) : await tx.coverage.create({ data });
    await audit({ userId: user.id, action: id ? "COVERAGE_UPDATED" : "COVERAGE_CREATED", entity: "Coverage", entityId: row.id, details: data }, tx);
  });
  refresh();
  return saved();
}

// ───────────────────────── Especialidades ─────────────────────────

const specialtySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Ingresá el nombre de la especialidad").max(60),
  minAgeYears: optionalInt(0, 120),
  maxAgeYears: optionalInt(0, 120),
  active: checkbox,
});

export async function saveSpecialty(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = specialtySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));
  const { id, ...data } = parsed.data;

  if (data.minAgeYears !== null && data.maxAgeYears !== null && data.minAgeYears > data.maxAgeYears) {
    return failed("La edad mínima no puede ser mayor que la máxima.");
  }
  const sameName = await db.specialty.findFirst({ where: { name: data.name, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
  if (sameName) return failed("Ya hay una especialidad con ese nombre.");

  await db.$transaction(async (tx) => {
    const row = id ? await tx.specialty.update({ where: { id }, data }) : await tx.specialty.create({ data });
    await audit({ userId: user.id, action: id ? "SPECIALTY_UPDATED" : "SPECIALTY_CREATED", entity: "Specialty", entityId: row.id, details: data }, tx);
  });
  refresh();
  return saved();
}

// ───────────────────────── Consultorios ─────────────────────────

const officeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Ingresá el nombre del consultorio").max(60),
  active: checkbox,
});

export async function saveOffice(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const parsed = officeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));
  const { id, ...data } = parsed.data;

  const sameName = await db.office.findFirst({ where: { name: data.name, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
  if (sameName) return failed("Ya hay un consultorio con ese nombre.");

  await db.$transaction(async (tx) => {
    const row = id ? await tx.office.update({ where: { id }, data }) : await tx.office.create({ data });
    await audit({ userId: user.id, action: id ? "OFFICE_UPDATED" : "OFFICE_CREATED", entity: "Office", entityId: row.id, details: data }, tx);
  });
  refresh();
  return saved();
}
