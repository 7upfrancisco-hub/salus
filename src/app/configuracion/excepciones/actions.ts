"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageProfessional } from "@/lib/access";
import { audit } from "@/lib/audit";
import { isGlobalEditor, requireConfigUser } from "@/lib/config-access";
import { EXCEPTION_KIND } from "@/lib/constants";
import { db } from "@/lib/db";
import { failed, saved, summarize, type FormState } from "@/lib/form-state";
import { countAppointmentsInRange } from "@/lib/impact";
import { fieldErrors } from "@/lib/validation";
import { addDaysToDate, timeToMinutes, todayInZone } from "@/lib/time";

async function timezone() {
  return (await db.centerSettings.findUnique({ where: { id: 1 } }))?.timezone ?? "America/Argentina/Buenos_Aires";
}

function refresh() {
  revalidatePath("/configuracion/excepciones");
  revalidatePath("/agenda", "layout");
}

const exceptionSchema = z.object({
  kind: z.enum([EXCEPTION_KIND.HOLIDAY, EXCEPTION_KIND.LEAVE, EXCEPTION_KIND.BLOCK], "Elegí el tipo"),
  professionalId: z.string().optional(),
  dateFrom: z.iso.date("Elegí la fecha de inicio"),
  dateTo: z.union([z.iso.date(), z.literal("")]).optional(),
  partial: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  note: z.string().trim().max(120).optional(),
});

export async function createException(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireConfigUser();
  const parsed = exceptionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));
  const data = parsed.data;

  const professionalId = data.professionalId || null;
  if (professionalId) {
    if (!(await canManageProfessional(user, professionalId))) return failed("No tenés acceso a esa agenda.");
  } else if (!isGlobalEditor(user)) {
    return failed("Los feriados y bloqueos de todo el centro los carga administración.");
  }
  if (data.kind === EXCEPTION_KIND.LEAVE && !professionalId) return failed("Una licencia es de un profesional: elegilo.");

  const dateTo = data.dateTo || data.dateFrom;
  if (dateTo < data.dateFrom) return failed("La fecha final no puede ser anterior a la inicial.");
  if (dateTo > addDaysToDate(data.dateFrom, 366)) return failed("El período no puede superar un año.");

  let startMinutes: number | null = null;
  let endMinutes: number | null = null;
  if (data.partial === "on") {
    startMinutes = timeToMinutes(data.start ?? "");
    endMinutes = timeToMinutes(data.end ?? "");
    if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) return failed("Indicá una franja horaria válida (la hora de inicio debe ser anterior a la de fin).");
  }

  const tz = await timezone();
  if (dateTo < todayInZone(tz)) return failed("Esas fechas ya pasaron.");

  const created = await db.$transaction(async (tx) => {
    const exception = await tx.scheduleException.create({
      data: {
        kind: data.kind,
        professionalId,
        dateFrom: data.dateFrom,
        dateTo,
        startMinutes,
        endMinutes,
        note: data.note || null,
        createdById: user.id,
      },
    });
    await audit({ userId: user.id, action: "EXCEPTION_CREATED", entity: "ScheduleException", entityId: exception.id, details: { ...data, professionalId } }, tx);
    return exception;
  });

  const affected = await countAppointmentsInRange(professionalId, created.dateFrom, created.dateTo, tz, startMinutes, endMinutes);
  refresh();
  return saved(affected > 0 ? `Atención: hay ${affected} turno(s) ya dados en ese período. No se cancelaron: revisalos en la agenda y avisá a los pacientes.` : undefined);
}

export async function deleteException(exceptionId: string): Promise<void> {
  const user = await requireConfigUser();
  const exception = await db.scheduleException.findUnique({ where: { id: exceptionId } });
  if (!exception) return;
  const allowed = exception.professionalId ? await canManageProfessional(user, exception.professionalId) : isGlobalEditor(user);
  if (!allowed) return;

  await db.$transaction(async (tx) => {
    await tx.scheduleException.delete({ where: { id: exceptionId } });
    await audit({ userId: user.id, action: "EXCEPTION_DELETED", entity: "ScheduleException", entityId: exceptionId, details: { exception } }, tx);
  });
  refresh();
}

// ───────────────────────── Sobreturnos habilitados ─────────────────────────

const allowanceSchema = z.object({
  professionalId: z.string().min(1, "Elegí el profesional"),
  date: z.iso.date("Elegí la fecha"),
  maxExtra: z.coerce.number("Indicá la cantidad").int().min(1, "Mínimo 1").max(20, "Máximo 20"),
  note: z.string().trim().max(120).optional(),
});

export async function saveAllowance(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireConfigUser();
  const parsed = allowanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(summarize(fieldErrors(parsed.error)));
  const data = parsed.data;

  if (!(await canManageProfessional(user, data.professionalId))) return failed("No tenés acceso a esa agenda.");
  if (data.date < todayInZone(await timezone())) return failed("Esa fecha ya pasó.");

  await db.$transaction(async (tx) => {
    const allowance = await tx.overbookAllowance.upsert({
      where: { professionalId_date: { professionalId: data.professionalId, date: data.date } },
      update: { maxExtra: data.maxExtra, note: data.note || null, createdById: user.id },
      create: { professionalId: data.professionalId, date: data.date, maxExtra: data.maxExtra, note: data.note || null, createdById: user.id },
    });
    await audit({ userId: user.id, action: "OVERBOOK_ALLOWANCE_SAVED", entity: "OverbookAllowance", entityId: allowance.id, details: data }, tx);
  });
  refresh();
  return saved();
}

export async function deleteAllowance(allowanceId: string): Promise<void> {
  const user = await requireConfigUser();
  const allowance = await db.overbookAllowance.findUnique({ where: { id: allowanceId } });
  if (!allowance || !(await canManageProfessional(user, allowance.professionalId))) return;

  await db.$transaction(async (tx) => {
    await tx.overbookAllowance.delete({ where: { id: allowanceId } });
    await audit({ userId: user.id, action: "OVERBOOK_ALLOWANCE_DELETED", entity: "OverbookAllowance", entityId: allowanceId }, tx);
  });
  refresh();
}
