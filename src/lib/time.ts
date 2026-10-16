/** Minutos desde las 00:00 -> "HH:MM". */
export function minutesToTime(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" -> minutos desde las 00:00 (o null si el formato es inválido). */
export function timeToMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Orden de días para mostrar en pantalla: lunes a domingo (0 = domingo en la base). */
export const WEEKDAYS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
] as const;

/** Fecha local YYYY-MM-DD de hoy en la zona horaria dada. */
export function todayInZone(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Suma días a una fecha YYYY-MM-DD (sin depender de la zona horaria). */
export function addDaysToDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDateEs(date: string) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function tzOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convierte una fecha local (YYYY-MM-DD) + minutos desde las 00:00 en esa zona a un instante UTC. */
export function zonedTimeToUtc(date: string, minutes: number, timeZone: string) {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  const offset = tzOffsetMs(new Date(naive), timeZone);
  let utc = naive - offset;
  // Ajuste por cambios de horario de verano (en Argentina no hay, pero queda correcto para otras zonas).
  const offsetAtUtc = tzOffsetMs(new Date(utc), timeZone);
  if (offsetAtUtc !== offset) utc = naive - offsetAtUtc;
  return new Date(utc);
}

/** Día de la semana (0 = domingo) de una fecha YYYY-MM-DD. */
export function weekdayOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Fecha local YYYY-MM-DD y minutos del día de un instante UTC, en la zona dada. */
export function utcToZoned(instant: Date, timeZone: string) {
  const offset = tzOffsetMs(instant, timeZone);
  const local = new Date(Math.floor(instant.getTime() / 1000) * 1000 + offset);
  return {
    date: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** Pone en mayúscula solo la primera letra ("lunes, 12 de octubre" → "Lunes, 12 de octubre"). */
export const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
