import { APPOINTMENT_STATUS } from "@/lib/constants";
import { SLOT_STATUS, type SlotStatus } from "@/lib/engine/types";

/** Explicación, en lenguaje de secretaría, de por qué un horario no está disponible. */
export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  AVAILABLE: "Disponible",
  NO_RULE: "No atiende esta cobertura",
  OUTSIDE_WINDOW: "Fuera de la franja de esta cobertura",
  EXCEPTION: "Licencia, feriado o bloqueo",
  OCCUPIED: "Ya hay un turno en ese horario",
  QUOTA_FULL: "Cupo completo",
  PAST: "Horario que ya pasó",
  NOTICE: "Falta la anticipación mínima",
  BEYOND_HORIZON: "Fuera del plazo de reserva online",
  AGE: "Edad fuera del rango de la especialidad",
};

/**
 * Reglas que secretaría puede saltear con un motivo registrado. El resto (licencias, feriados,
 * horarios pasados, cobertura no atendida, edad fuera de rango) se corrige cambiando la
 * configuración, no con un override.
 */
export const OVERRIDABLE_STATUSES: SlotStatus[] = [
  SLOT_STATUS.OUTSIDE_WINDOW,
  SLOT_STATUS.QUOTA_FULL,
  SLOT_STATUS.OCCUPIED,
  SLOT_STATUS.NOTICE,
  SLOT_STATUS.BEYOND_HORIZON,
];

export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  [APPOINTMENT_STATUS.RESERVED]: "Reservado",
  [APPOINTMENT_STATUS.CONFIRMED]: "Confirmado",
  [APPOINTMENT_STATUS.CANCELLED]: "Cancelado",
  [APPOINTMENT_STATUS.NO_SHOW]: "Ausente",
  [APPOINTMENT_STATUS.ATTENDED]: "Atendido",
};

export const VISIT_TYPE_LABEL: Record<string, string> = {
  FIRST: "Primera vez",
  CONTROL: "Control",
};

export const QUOTA_PERIOD_LABEL: Record<string, string> = {
  DAY: "día",
  WEEK: "semana",
  MONTH: "mes",
};

export const QUOTA_SCOPE_LABEL: Record<string, string> = {
  PROFESSIONAL: "por profesional",
  SPECIALTY: "compartido en la especialidad",
  CENTER: "compartido en todo el centro",
};
