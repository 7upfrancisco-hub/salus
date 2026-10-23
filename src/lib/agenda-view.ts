import "server-only";
import { APPOINTMENT_STATUS } from "@/lib/constants";
import { db } from "@/lib/db";
import { evaluarAgenda } from "@/lib/engine/engine";
import { loadEngineContext } from "@/lib/engine/load";
import { SLOT_STATUS, type QuotaCounter, type SlotStatus } from "@/lib/engine/types";
import { addDaysToDate, utcToZoned } from "@/lib/time";

/**
 * Modelo de datos de la agenda de secretaría. Cada horario libre muestra qué coberturas lo
 * pueden tomar y por qué las otras no, usando el MISMO motor que el turnero del paciente.
 */

export type CoverageInfo = { id: string; name: string; color: string; isParticular: boolean };

export type AppointmentView = {
  id: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  status: string;
  visitType: string;
  patientName: string;
  dni: string;
  phone: string;
  email: string | null;
  coverage: CoverageInfo;
  /** Solo en turnos preocupacionales. */
  studyName: string | null;
  company: string | null;
  affiliateNumber: string | null;
  officeName: string | null;
  notes: string | null;
  source: string;
  isOverride: boolean;
  overrideReason: string | null;
  overrideRules: SlotStatus[];
  createdByName: string | null;
  cancelReason: string | null;
  startsAtMs: number;
};

export type FreeSlotCoverage = { coverageId: string; status: SlotStatus; violations: SlotStatus[] };

export type AgendaRow =
  | { kind: "appointment"; startMinutes: number; endMinutes: number; appointment: AppointmentView }
  | {
      kind: "free";
      startMinutes: number;
      endMinutes: number;
      officeName: string | null;
      coverages: FreeSlotCoverage[];
    };

export type DayView = {
  date: string;
  weekday: number;
  closed: { kind: string; note: string | null } | null;
  rows: AgendaRow[];
  /** Franjas de cada cobertura ese día (para mostrarlas de fondo). */
  windows: { coverageId: string; startMinutes: number; endMinutes: number }[];
  /** Cupos de cada cobertura y cuánto se usó. */
  quotas: { coverageId: string; counters: QuotaCounter[] }[];
  cancelled: AppointmentView[];
};

export type RangeView = {
  professional: { id: string; name: string; specialtyName: string };
  coverages: CoverageInfo[];
  days: DayView[];
};

export async function buildRangeView(professionalId: string, from: string, to: string): Promise<RangeView | null> {
  const context = await loadEngineContext({ professionalId, from, to });
  if (!context) return null;

  const [professional, coverages, appointments, exceptions] = await Promise.all([
    db.professional.findUniqueOrThrow({ where: { id: professionalId }, include: { specialty: true } }),
    db.coverage.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.appointment.findMany({
      where: { professionalId, localDate: { gte: from, lte: to } },
      include: { patient: true, coverage: true, study: { select: { name: true } }, office: true, createdBy: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
    }),
    db.scheduleException.findMany({
      where: { dateFrom: { lte: to }, dateTo: { gte: from }, OR: [{ professionalId }, { professionalId: null }] },
    }),
  ]);

  const offices = new Map((await db.office.findMany()).map((o) => [o.id, o.name]));
  const coverageById = new Map(coverages.map((c) => [c.id, c]));
  const infoOf = (c: { id: string; name: string; color: string; isParticular: boolean }): CoverageInfo => ({
    id: c.id,
    name: c.name,
    color: c.color,
    isParticular: c.isParticular,
  });

  // Se evalúa la agenda una vez por cobertura (como "control": es la duración base del bloque).
  const evaluations = coverages.map((coverage) => ({
    coverage,
    result: evaluarAgenda(context.inputFor({ coverageId: coverage.id, visitType: "CONTROL", audience: "staff" })),
  }));

  const timezone = context.settings.timezone;
  const toView = (a: (typeof appointments)[number]): AppointmentView => {
    const start = utcToZoned(a.startsAt, timezone);
    const end = utcToZoned(a.endsAt, timezone);
    return {
      id: a.id,
      date: a.localDate,
      startMinutes: start.minutes,
      endMinutes: end.date === start.date ? end.minutes : 24 * 60,
      status: a.status,
      visitType: a.visitType,
      patientName: `${a.patient.lastName}, ${a.patient.firstName}`,
      dni: a.patient.dni,
      phone: a.patient.phone,
      email: a.patient.email,
      coverage: infoOf(coverageById.get(a.coverageId) ?? { ...a.coverage }),
      studyName: a.study?.name ?? null,
      company: a.company,
      affiliateNumber: a.affiliateNumber,
      officeName: a.officeId ? (offices.get(a.officeId) ?? null) : null,
      notes: a.notes,
      source: a.source,
      isOverride: a.isOverride,
      overrideReason: a.overrideReason,
      overrideRules: a.overrideRules ? (JSON.parse(a.overrideRules) as SlotStatus[]) : [],
      createdByName: a.createdBy?.name ?? null,
      cancelReason: a.cancelReason,
      startsAtMs: a.startsAt.getTime(),
    };
  };

  const days: DayView[] = [];
  for (let date = from; date <= to; date = addDaysToDate(date, 1)) {
    const views = appointments.filter((a) => a.localDate === date).map(toView);
    const active = views.filter((v) => v.status !== APPOINTMENT_STATUS.CANCELLED);
    const cancelled = views.filter((v) => v.status === APPOINTMENT_STATUS.CANCELLED);

    // Horarios base del día: la unión de los de todas las coberturas.
    const grid = new Map<number, { startMinutes: number; endMinutes: number; officeId: string | null; byCoverage: FreeSlotCoverage[] }>();
    let weekday = 0;
    let closedBy: { id: string; kind: string } | null = null;
    const windows: DayView["windows"] = [];
    const quotas: DayView["quotas"] = [];

    for (const { coverage, result } of evaluations) {
      const day = result.days.find((d) => d.date === date)!;
      weekday = day.weekday;
      closedBy = closedBy ?? day.closedBy;
      if (result.rule) {
        for (const w of result.rule.windows.filter((w) => w.weekday === day.weekday)) {
          windows.push({ coverageId: coverage.id, startMinutes: w.startMinutes, endMinutes: w.endMinutes });
        }
      }
      if (day.quotas.length > 0) quotas.push({ coverageId: coverage.id, counters: day.quotas });

      for (const slot of day.slots) {
        const entry = grid.get(slot.startMinutes) ?? { startMinutes: slot.startMinutes, endMinutes: slot.endMinutes, officeId: slot.officeId, byCoverage: [] };
        entry.byCoverage.push({ coverageId: coverage.id, status: slot.status, violations: slot.violations });
        grid.set(slot.startMinutes, entry);
      }
    }

    // Un horario libre no se muestra si un turno lo está ocupando.
    const freeRows: AgendaRow[] = [...grid.values()]
      .filter((g) => !active.some((a) => a.startMinutes < g.endMinutes && g.startMinutes < a.endMinutes))
      .map((g) => ({
        kind: "free" as const,
        startMinutes: g.startMinutes,
        endMinutes: g.endMinutes,
        officeName: g.officeId ? (offices.get(g.officeId) ?? null) : null,
        coverages: g.byCoverage,
      }));
    const appointmentRows: AgendaRow[] = active.map((a) => ({
      kind: "appointment" as const,
      startMinutes: a.startMinutes,
      endMinutes: a.endMinutes,
      appointment: a,
    }));

    const rows = [...appointmentRows, ...freeRows].sort(
      (a, b) => a.startMinutes - b.startMinutes || (a.kind === "appointment" ? -1 : 1),
    );

    const exception = closedBy ? exceptions.find((e) => e.id === closedBy!.id) : null;
    days.push({
      date,
      weekday,
      closed: closedBy ? { kind: closedBy.kind, note: exception?.note ?? null } : null,
      rows,
      windows,
      quotas,
      cancelled,
    });
  }

  return {
    professional: { id: professional.id, name: professional.name, specialtyName: professional.specialty.name },
    coverages: coverages.map(infoOf),
    days,
  };
}

/** ¿Tiene el horario algún estado que permita darlo sin override? */
export const isFree = (c: FreeSlotCoverage) => c.status === SLOT_STATUS.AVAILABLE;
