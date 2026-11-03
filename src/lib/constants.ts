export const ROLES = {
  ADMIN: "ADMIN",
  SECRETARY: "SECRETARY",
  PROFESSIONAL: "PROFESSIONAL",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const APPOINTMENT_STATUS = {
  RESERVED: "RESERVED",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
  ATTENDED: "ATTENDED",
} as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[keyof typeof APPOINTMENT_STATUS];

/**
 * Estados que ocupan el horario y consumen cupo. Un turno cancelado libera ambos;
 * un ausente sigue consumiendo cupo (el lugar se perdió).
 */
export const ACTIVE_STATUSES: AppointmentStatus[] = [
  APPOINTMENT_STATUS.RESERVED,
  APPOINTMENT_STATUS.CONFIRMED,
  APPOINTMENT_STATUS.NO_SHOW,
  APPOINTMENT_STATUS.ATTENDED,
];

export const VISIT_TYPE = {
  FIRST: "FIRST",
  CONTROL: "CONTROL",
} as const;
export type VisitType = (typeof VISIT_TYPE)[keyof typeof VISIT_TYPE];

export const APPOINTMENT_SOURCE = {
  PUBLIC: "PUBLIC",
  STAFF: "STAFF",
} as const;

export const QUOTA_PERIOD = {
  DAY: "DAY",
  WEEK: "WEEK",
  MONTH: "MONTH",
} as const;
export type QuotaPeriod = (typeof QUOTA_PERIOD)[keyof typeof QUOTA_PERIOD];

/** Quién comparte un cupo. */
export const QUOTA_SCOPE = {
  PROFESSIONAL: "PROFESSIONAL",
  SPECIALTY: "SPECIALTY",
  CENTER: "CENTER",
} as const;
export type QuotaScope = (typeof QUOTA_SCOPE)[keyof typeof QUOTA_SCOPE];

export const EXCEPTION_KIND = {
  HOLIDAY: "HOLIDAY",
  LEAVE: "LEAVE",
  BLOCK: "BLOCK",
} as const;
export type ExceptionKind = (typeof EXCEPTION_KIND)[keyof typeof EXCEPTION_KIND];

export const WAITLIST_STATUS = {
  WAITING: "WAITING",
  NOTIFIED: "NOTIFIED",
  BOOKED: "BOOKED",
  CANCELLED: "CANCELLED",
} as const;

export const NOTIFICATION_KIND = {
  CONFIRMATION: "CONFIRMATION",
  REMINDER: "REMINDER",
  CANCELLATION: "CANCELLATION",
  WAITLIST: "WAITLIST",
} as const;

export const NOTIFICATION_STATUS = {
  PENDING: "PENDING",
  /** Tomado por un proceso de envío (evita mandar el mismo mail dos veces). */
  SENDING: "SENDING",
  SENT: "SENT",
  FAILED: "FAILED",
  /** No se envió a propósito (turno cancelado, o el envío de mails no está configurado). */
  SKIPPED: "SKIPPED",
} as const;

/**
 * Cuentas del turnero online. Una cuenta "sin verificar" (la secretaría todavía no vio el DNI en persona) puede
 * tener menos turnos futuros a la vez, para limitar el daño si alguien se registra con el DNI de otra persona.
 */
export const ACCOUNT_MAX_ACTIVE = { UNVERIFIED: 2, VERIFIED: 10 } as const;
/** Personas a cargo (hijos, etc.) que puede agregar una cuenta. */
export const MAX_DEPENDENTS = 6;
export const ACCOUNT_RELATION = { CHILD: "CHILD", OTHER: "OTHER" } as const;
export const ACCOUNT_RELATION_LABEL: Record<string, string> = { CHILD: "Hijo/a", OTHER: "Otra persona a cargo" };

/** Zona horaria del centro mientras no se configure otra (Configuración → Centro). */
export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

/** Rutas que no pueden usarse como identificador público. */
export const RESERVED_SLUGS = ["admin", "agenda", "login", "logout", "api", "turno", "_next"];
