import type { QuotaPeriod, QuotaScope, VisitType } from "@/lib/constants";

/**
 * Tipos de entrada y salida del motor de turnos. Son objetos planos (sin Prisma) para que el
 * motor sea una función pura: mismos datos de entrada, mismo resultado, fácil de testear.
 *
 * Fechas "de calendario" = texto YYYY-MM-DD en la zona horaria del centro.
 * Horas dentro de un día = minutos desde las 00:00.
 */

export type Window = { weekday: number; startMinutes: number; endMinutes: number };

export type Quota = {
  id: string;
  period: QuotaPeriod;
  max: number;
  scope: QuotaScope;
  /** Días de la semana en que rige el cupo. Null = todos. */
  weekdays: number[] | null;
};

export type Rule = {
  id: string;
  coverageId: string;
  /** Una regla es de un profesional o de toda una especialidad (uno de los dos). */
  professionalId: string | null;
  specialtyId: string | null;
  active: boolean;
  firstVisitMinutes: number | null;
  controlMinutes: number | null;
  windows: Window[];
  quotas: Quota[];
  requirements: string[];
};

export type Block = {
  id: string;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
  officeId: string | null;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
};

export type Exception = {
  id: string;
  kind: "HOLIDAY" | "LEAVE" | "BLOCK";
  /** Null = todo el centro. */
  professionalId: string | null;
  dateFrom: string;
  dateTo: string;
  /** Si faltan, la excepción es de día completo. */
  startMinutes: number | null;
  endMinutes: number | null;
};

/** Turno ya existente. El motor decide cuáles ocupan lugar y consumen cupo según su estado. */
export type ExistingAppointment = {
  id: string;
  professionalId: string;
  specialtyId: string;
  coverageId: string;
  startsAt: Date;
  endsAt: Date;
  localDate: string;
  status: string;
};

export type EngineInput = {
  professional: { id: string; specialtyId: string };
  coverageId: string;
  visitType: VisitType;
  /** Rango de fechas a evaluar, ambos extremos incluidos. */
  range: { from: string; to: string };
  /** "Ahora" inyectado (así los tests no dependen del reloj). */
  now: Date;
  timezone: string;
  /**
   * Límites que aplican al paciente online. Para secretaría va en null: puede dar turnos
   * con menos anticipación y más lejos (igual no se ofrecen horarios que ya pasaron).
   */
  limits: { minNoticeHours: number; horizonDays: number } | null;
  /** Si se informa, se valida el rango de edad de la especialidad a la fecha del turno. */
  patient?: { birthDate: string } | null;
  specialty?: { minAgeYears: number | null; maxAgeYears: number | null };
  /** Para reprogramar o cambiar de cobertura: este turno no cuenta contra sí mismo. */
  excludeAppointmentId?: string | null;

  blocks: Block[];
  /** Reglas de cualquier profesional/especialidad: el motor elige la que corresponde. */
  rules: Rule[];
  exceptions: Exception[];
  appointments: ExistingAppointment[];
};

/** Por qué un horario está (o no) disponible. */
export const SLOT_STATUS = {
  AVAILABLE: "AVAILABLE",
  /** La cobertura no tiene regla para este profesional (no la atiende). */
  NO_RULE: "NO_RULE",
  /** Fuera de las ventanas horarias de la cobertura. */
  OUTSIDE_WINDOW: "OUTSIDE_WINDOW",
  /** Feriado, licencia o bloqueo. */
  EXCEPTION: "EXCEPTION",
  /** Ya hay otro turno en ese horario. */
  OCCUPIED: "OCCUPIED",
  /** Algún cupo de la cobertura está completo para ese día, semana o mes. */
  QUOTA_FULL: "QUOTA_FULL",
  PAST: "PAST",
  /** Menos anticipación de la mínima. */
  NOTICE: "NOTICE",
  BEYOND_HORIZON: "BEYOND_HORIZON",
  /** La edad del paciente no entra en el rango de la especialidad. */
  AGE: "AGE",
} as const;
export type SlotStatus = (typeof SLOT_STATUS)[keyof typeof SLOT_STATUS];

export type SlotEvaluation = {
  date: string;
  startMinutes: number;
  /** Fin del turno según el tipo de visita (puede ser más largo que la grilla del bloque). */
  endMinutes: number;
  durationMinutes: number;
  startsAt: Date;
  endsAt: Date;
  blockId: string;
  officeId: string | null;
  status: SlotStatus;
  /** Todas las reglas que incumple (vacío si está disponible). "status" es la primera por prioridad. */
  violations: SlotStatus[];
  /** Detalle de la causa, para mostrar a secretaría o registrar un override. */
  quotaId?: string;
  exceptionId?: string;
};

export type QuotaCounter = {
  quotaId: string;
  period: QuotaPeriod;
  scope: QuotaScope;
  /** Clave del período: la fecha (día), el lunes de la semana, o YYYY-MM (mes). */
  periodKey: string;
  max: number;
  used: number;
  full: boolean;
};

export type DayEvaluation = {
  date: string;
  weekday: number;
  /** Excepción de día completo que cierra la agenda ese día. */
  closedBy: { id: string; kind: Exception["kind"] } | null;
  slots: SlotEvaluation[];
  /** Cupos que rigen ese día con cuántos turnos se usaron. */
  quotas: QuotaCounter[];
};

export type AgendaEvaluation = {
  /** Regla que se aplicó (null si el profesional no atiende esa cobertura). */
  rule: Rule | null;
  days: DayEvaluation[];
};

export type Availability = {
  requirements: string[];
  days: { date: string; slots: SlotEvaluation[] }[];
};
