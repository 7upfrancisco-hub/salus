import "server-only";
import { ACTIVE_STATUSES, type QuotaPeriod, type QuotaScope, type VisitType } from "@/lib/constants";
import { db } from "@/lib/db";
import { widenRange } from "./periods";
import type { EngineInput } from "./types";

/** Acepta el cliente normal o el de una transacción, para validar y guardar de forma atómica. */
export type DbClient = Pick<
  typeof db,
  "centerSettings" | "professional" | "agendaBlock" | "coverageRule" | "scheduleException" | "appointment"
>;

export type ContextOptions = {
  professionalId: string;
  /** Rango a evaluar, YYYY-MM-DD, ambos incluidos. */
  from: string;
  to: string;
  patientBirthDate?: string | null;
  /** Turno que se está reprogramando o cambiando de cobertura (no cuenta contra sí mismo). */
  excludeAppointmentId?: string | null;
  now?: Date;
  client?: DbClient;
};

export type InputOptions = {
  coverageId: string;
  visitType: VisitType;
  /**
   * "patient": aplica anticipación mínima y horizonte de reserva del turnero online.
   * "staff": secretaría puede dar turnos con menos anticipación y más lejos.
   */
  audience: "patient" | "staff";
};

export type EngineContext = {
  professional: { id: string; name: string; specialtyId: string };
  settings: {
    timezone: string;
    minNoticeHours: number;
    bookingHorizonDays: number;
    cancelLimitHours: number;
    reminderHoursBefore: number;
  };
  /** Arma la entrada del motor para una cobertura sin volver a consultar la base. */
  inputFor(options: InputOptions): EngineInput;
};

const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

const parseWeekdays = (csv: string | null) =>
  csv ? csv.split(",").map((n) => Number(n.trim())).filter((n) => Number.isInteger(n)) : null;

/**
 * Carga de la base todo lo que el motor necesita para un profesional y un rango (agenda, reglas de
 * todas las coberturas, excepciones y turnos). No decide nada: la lógica vive en engine.ts.
 * Devuelve null si el profesional no existe o está inactivo.
 */
export async function loadEngineContext(options: ContextOptions): Promise<EngineContext | null> {
  const client = options.client ?? db;
  const { professionalId, from, to } = options;

  const professional = await client.professional.findUnique({
    where: { id: professionalId },
    include: { specialty: true },
  });
  if (!professional || !professional.active) return null;

  const wide = widenRange(from, to);

  const [settings, blocks, rules, exceptions, appointments] = await Promise.all([
    client.centerSettings.findUnique({ where: { id: 1 } }),
    client.agendaBlock.findMany({ where: { professionalId, active: true } }),
    client.coverageRule.findMany({
      where: { OR: [{ professionalId }, { professionalId: null, specialtyId: professional.specialtyId }] },
      include: {
        windows: true,
        quotas: true,
        requirements: { orderBy: { sortOrder: "asc" } },
      },
    }),
    client.scheduleException.findMany({
      where: {
        dateFrom: { lte: to },
        dateTo: { gte: from },
        OR: [{ professionalId }, { professionalId: null }],
      },
    }),
    // Todos los turnos activos del período: los del profesional ocupan horario y los de cualquier
    // profesional pueden consumir cupos compartidos (por especialidad o por todo el centro).
    client.appointment.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        localDate: { gte: wide.from, lte: wide.to },
      },
      select: {
        id: true,
        professionalId: true,
        coverageId: true,
        startsAt: true,
        endsAt: true,
        localDate: true,
        status: true,
        professional: { select: { specialtyId: true } },
      },
    }),
  ]);

  const resolved = {
    timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
    minNoticeHours: settings?.minNoticeHours ?? 2,
    bookingHorizonDays: settings?.bookingHorizonDays ?? 60,
    cancelLimitHours: settings?.cancelLimitHours ?? 12,
    reminderHoursBefore: settings?.reminderHoursBefore ?? 24,
  };

  const common = {
    professional: { id: professional.id, specialtyId: professional.specialtyId },
    range: { from, to },
    now: options.now ?? new Date(),
    timezone: resolved.timezone,
    patient: options.patientBirthDate ? { birthDate: options.patientBirthDate } : null,
    specialty: {
      minAgeYears: professional.specialty.minAgeYears,
      maxAgeYears: professional.specialty.maxAgeYears,
    },
    excludeAppointmentId: options.excludeAppointmentId ?? null,
    blocks: blocks.map((b) => ({
      id: b.id,
      weekday: b.weekday,
      startMinutes: b.startMinutes,
      endMinutes: b.endMinutes,
      slotMinutes: b.slotMinutes,
      officeId: b.officeId,
      active: b.active,
      validFrom: b.validFrom,
      validTo: b.validTo,
    })),
    rules: rules.map((r) => ({
      id: r.id,
      coverageId: r.coverageId,
      professionalId: r.professionalId,
      specialtyId: r.specialtyId,
      active: r.active,
      firstVisitMinutes: r.firstVisitMinutes,
      controlMinutes: r.controlMinutes,
      windows: r.windows.map((w) => ({ weekday: w.weekday, startMinutes: w.startMinutes, endMinutes: w.endMinutes })),
      quotas: r.quotas.map((q) => ({
        id: q.id,
        period: q.period as QuotaPeriod,
        max: q.max,
        scope: q.scope as QuotaScope,
        weekdays: parseWeekdays(q.weekdays),
      })),
      requirements: r.requirements.map((req) => req.text),
    })),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      kind: e.kind as "HOLIDAY" | "LEAVE" | "BLOCK",
      professionalId: e.professionalId,
      dateFrom: e.dateFrom,
      dateTo: e.dateTo,
      startMinutes: e.startMinutes,
      endMinutes: e.endMinutes,
    })),
    appointments: appointments.map((a) => ({
      id: a.id,
      professionalId: a.professionalId,
      specialtyId: a.professional.specialtyId,
      coverageId: a.coverageId,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      localDate: a.localDate,
      status: a.status,
    })),
  };

  return {
    professional: { id: professional.id, name: professional.name, specialtyId: professional.specialtyId },
    settings: resolved,
    inputFor: ({ coverageId, visitType, audience }) => ({
      ...common,
      coverageId,
      visitType,
      limits:
        audience === "patient"
          ? { minNoticeHours: resolved.minNoticeHours, horizonDays: resolved.bookingHorizonDays }
          : null,
    }),
  };
}

/** Atajo: contexto + entrada para una sola cobertura. */
export async function loadEngineInput(options: ContextOptions & InputOptions): Promise<EngineInput | null> {
  const context = await loadEngineContext(options);
  return context ? context.inputFor(options) : null;
}
