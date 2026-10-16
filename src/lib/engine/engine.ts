import { ACTIVE_STATUSES } from "@/lib/constants";
import { addDaysToDate, utcToZoned, weekdayOf, zonedTimeToUtc } from "@/lib/time";
import { ageInYears, eachDate, periodKey } from "./periods";
import {
  SLOT_STATUS,
  type AgendaEvaluation,
  type Availability,
  type Block,
  type DayEvaluation,
  type EngineInput,
  type Exception,
  type ExistingAppointment,
  type Quota,
  type QuotaCounter,
  type Rule,
  type SlotEvaluation,
  type SlotStatus,
} from "./types";

/**
 * MOTOR DE TURNOS.
 *
 * `evaluarAgenda` es la única fuente de verdad: recorre la agenda base del profesional y clasifica
 * CADA horario con un estado (disponible, ocupado, fuera de franja, cupo lleno…). Lo usan por igual
 * la vista del paciente (`turnosDisponibles`, que se queda con los disponibles), la de secretaría
 * (que muestra el porqué de cada horario) y la validación al guardar un turno (`verificarTurno`),
 * así que nunca pueden contradecirse.
 *
 * Orden en que se descarta un horario:
 *   edad → tiempo (pasado / anticipación / horizonte) → excepciones → regla de la cobertura →
 *   ventana horaria → ocupado → cupos.
 *
 * Reglas de negocio que implementa (todas editables como datos, ninguna escrita a mano):
 *  - Una regla de profesional pisa a la de su especialidad para la misma cobertura. Si la regla
 *    del profesional existe pero está inactiva, esa cobertura no se atiende (no se cae a la de la
 *    especialidad).
 *  - El turno completo (según primera vez / control) debe entrar en el bloque y en la ventana.
 *  - Los turnos cancelados no ocupan lugar ni consumen cupo. Reservado, confirmado, ausente y
 *    atendido sí. Los sobreturnos y saltos de regla cuentan como cualquier otro turno.
 *  - Un cupo lleno para un día, semana o mes de calendario (la semana va de lunes a domingo)
 *    quita todos los horarios de ESE período para ESA cobertura.
 *  - Un cupo con `weekdays` solo rige, y solo cuenta turnos, en esos días de la semana.
 *  - Alcance del cupo: por profesional, compartido por la especialidad o por todo el centro.
 */

const ACTIVE = new Set<string>(ACTIVE_STATUSES);

/** Si un horario incumple varias reglas, "status" muestra la primera de esta lista. */
const STATUS_PRIORITY: SlotStatus[] = [
  SLOT_STATUS.AGE,
  SLOT_STATUS.PAST,
  SLOT_STATUS.NOTICE,
  SLOT_STATUS.BEYOND_HORIZON,
  SLOT_STATUS.EXCEPTION,
  SLOT_STATUS.NO_RULE,
  SLOT_STATUS.OUTSIDE_WINDOW,
  SLOT_STATUS.OCCUPIED,
  SLOT_STATUS.QUOTA_FULL,
];

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd;

/** Regla que corresponde aplicar al profesional para la cobertura pedida (o null). */
export function resolveRule<R extends Pick<Rule, "coverageId" | "professionalId" | "specialtyId" | "active">>(input: {
  professional: EngineInput["professional"];
  coverageId: string;
  rules: R[];
}): R | null {
  const { professional, coverageId, rules } = input;

  const own = rules.find((r) => r.coverageId === coverageId && r.professionalId === professional.id);
  if (own) return own.active ? own : null;

  const shared = rules.find(
    (r) =>
      r.coverageId === coverageId &&
      r.professionalId === null &&
      r.specialtyId === professional.specialtyId,
  );
  return shared?.active ? shared : null;
}

function blockAppliesOn(block: Block, date: string) {
  if (!block.active || block.weekday !== weekdayOf(date)) return false;
  if (block.validFrom && date < block.validFrom) return false;
  if (block.validTo && date > block.validTo) return false;
  return true;
}

function ageViolation(input: EngineInput, date: string) {
  const birthDate = input.patient?.birthDate;
  const range = input.specialty;
  if (!birthDate || !range) return false;
  const age = ageInYears(birthDate, date);
  return (range.minAgeYears !== null && age < range.minAgeYears) || (range.maxAgeYears !== null && age > range.maxAgeYears);
}

export function evaluarAgenda(input: EngineInput): AgendaEvaluation {
  const { professional, coverageId, visitType, range, now, timezone, limits } = input;
  const rule = resolveRule(input);

  const counted = input.appointments.filter(
    (a) => ACTIVE.has(a.status) && a.id !== (input.excludeAppointmentId ?? null),
  );
  const occupying = counted.filter((a) => a.professionalId === professional.id);
  const coverageAppointments = counted.filter((a) => a.coverageId === coverageId);

  const todayLocal = utcToZoned(now, timezone).date;
  const lastBookableDate = limits ? addDaysToDate(todayLocal, limits.horizonDays) : null;
  const earliestStart = limits ? new Date(now.getTime() + limits.minNoticeHours * 3_600_000) : now;

  // Cantidad de turnos ya usados de un cupo en el período que contiene a la fecha.
  const usageCache = new Map<string, number>();
  function quotaUsed(quota: Quota, key: string) {
    const cacheKey = `${quota.id}|${key}`;
    const cached = usageCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const used = coverageAppointments.filter(
      (a) =>
        periodKey(quota.period, a.localDate) === key &&
        (quota.weekdays === null || quota.weekdays.includes(weekdayOf(a.localDate))) &&
        sameScope(quota, a, professional),
    ).length;
    usageCache.set(cacheKey, used);
    return used;
  }

  const days: DayEvaluation[] = [];

  for (const date of eachDate(range.from, range.to)) {
    const weekday = weekdayOf(date);

    const dayExceptions = input.exceptions.filter(
      (e) =>
        e.dateFrom <= date &&
        date <= e.dateTo &&
        (e.professionalId === null || e.professionalId === professional.id),
    );
    const wholeDay = dayExceptions.find((e) => e.startMinutes === null || e.endMinutes === null) ?? null;
    const partial = dayExceptions.filter((e) => e.startMinutes !== null && e.endMinutes !== null);

    // Cupos que rigen este día y cuánto se usó de cada uno.
    const counters: QuotaCounter[] = [];
    const activeQuotas = (rule?.quotas ?? []).filter((q) => q.weekdays === null || q.weekdays.includes(weekday));
    for (const quota of activeQuotas) {
      const key = periodKey(quota.period, date);
      const used = quotaUsed(quota, key);
      counters.push({
        quotaId: quota.id,
        period: quota.period,
        scope: quota.scope,
        periodKey: key,
        max: quota.max,
        used,
        full: used >= quota.max,
      });
    }
    const fullQuota = counters.find((c) => c.full) ?? null;

    const tooYoungOrOld = ageViolation(input, date);
    const slots: SlotEvaluation[] = [];
    const seenStarts = new Set<number>();

    const blocks = input.blocks
      .filter((b) => blockAppliesOn(b, date))
      .sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));

    for (const block of blocks) {
      const special = visitType === "FIRST" ? rule?.firstVisitMinutes : rule?.controlMinutes;
      const duration = special ?? block.slotMinutes;

      for (let start = block.startMinutes; start + duration <= block.endMinutes; start += block.slotMinutes) {
        // Si dos bloques se superponen, el horario se muestra una sola vez.
        if (seenStarts.has(start)) continue;
        seenStarts.add(start);

        const end = start + duration;
        const startsAt = zonedTimeToUtc(date, start, timezone);
        const endsAt = zonedTimeToUtc(date, end, timezone);

        const slot: SlotEvaluation = {
          date,
          startMinutes: start,
          endMinutes: end,
          durationMinutes: duration,
          startsAt,
          endsAt,
          blockId: block.id,
          officeId: block.officeId,
          status: SLOT_STATUS.AVAILABLE,
          violations: [],
        };

        let timeStatus: SlotStatus | null = null;
        if (startsAt < now) timeStatus = SLOT_STATUS.PAST;
        else if (limits && startsAt < earliestStart) timeStatus = SLOT_STATUS.NOTICE;
        else if (lastBookableDate && date > lastBookableDate) timeStatus = SLOT_STATUS.BEYOND_HORIZON;

        const blockingException: Exception | undefined =
          wholeDay ?? partial.find((e) => overlaps(start, end, e.startMinutes!, e.endMinutes!));

        // Se reúnen TODAS las reglas que el horario incumple (no solo la primera): secretaría las ve
        // completas y, si da un turno salteando reglas, quedan todas registradas.
        const violated = new Set<SlotStatus>();
        if (tooYoungOrOld) violated.add(SLOT_STATUS.AGE);
        if (timeStatus) violated.add(timeStatus);
        if (blockingException) {
          violated.add(SLOT_STATUS.EXCEPTION);
          slot.exceptionId = blockingException.id;
        }
        if (!rule) {
          violated.add(SLOT_STATUS.NO_RULE);
        } else {
          if (!rule.windows.some((w) => w.weekday === weekday && w.startMinutes <= start && end <= w.endMinutes)) {
            violated.add(SLOT_STATUS.OUTSIDE_WINDOW);
          }
          if (fullQuota) {
            violated.add(SLOT_STATUS.QUOTA_FULL);
            slot.quotaId = fullQuota.quotaId;
          }
        }
        if (occupying.some((a) => overlaps(startsAt.getTime(), endsAt.getTime(), a.startsAt.getTime(), a.endsAt.getTime()))) {
          violated.add(SLOT_STATUS.OCCUPIED);
        }

        slot.violations = STATUS_PRIORITY.filter((status) => violated.has(status));
        slot.status = slot.violations[0] ?? SLOT_STATUS.AVAILABLE;

        slots.push(slot);
      }
    }

    slots.sort((a, b) => a.startMinutes - b.startMinutes);
    days.push({
      date,
      weekday,
      closedBy: wholeDay ? { id: wholeDay.id, kind: wholeDay.kind } : null,
      slots,
      quotas: counters,
    });
  }

  return { rule, days };
}

function sameScope(quota: Quota, appointment: ExistingAppointment, professional: EngineInput["professional"]) {
  switch (quota.scope) {
    case "PROFESSIONAL":
      return appointment.professionalId === professional.id;
    case "SPECIALTY":
      return appointment.specialtyId === professional.specialtyId;
    case "CENTER":
      return true;
  }
}

/**
 * Horarios que el paciente realmente puede tomar con su cobertura, más los requisitos que debe
 * presentar. Solo incluye días con al menos un horario libre.
 */
export function turnosDisponibles(input: EngineInput): Availability {
  const { rule, days } = evaluarAgenda(input);
  return {
    requirements: rule?.requirements ?? [],
    days: days
      .map((day) => ({
        date: day.date,
        slots: day.slots.filter((s) => s.status === SLOT_STATUS.AVAILABLE),
      }))
      .filter((day) => day.slots.length > 0),
  };
}

/**
 * Evalúa un horario puntual con exactamente las mismas reglas. Es lo que debe llamar el backend al
 * guardar un turno (dentro de la transacción): devuelve null si ese horario no existe en la agenda.
 * Un turno solo puede guardarse si el estado es AVAILABLE; secretaría puede saltear el resto
 * con un override, y el estado devuelto es lo que se registra como "regla salteada".
 */
export function verificarTurno(input: EngineInput, date: string, startMinutes: number): SlotEvaluation | null {
  const { days } = evaluarAgenda({ ...input, range: { from: date, to: date } });
  return days[0]?.slots.find((s) => s.startMinutes === startMinutes) ?? null;
}

/** Primer horario libre dentro de un resultado de `turnosDisponibles` (para "próxima fecha disponible"). */
export function primerTurnoDisponible(availability: Availability): SlotEvaluation | null {
  return availability.days[0]?.slots[0] ?? null;
}
