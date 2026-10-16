import type { QuotaPeriod } from "@/lib/constants";
import { addDaysToDate, weekdayOf } from "@/lib/time";

/** Lunes de la semana de calendario que contiene la fecha (la semana va de lunes a domingo). */
export function weekStart(date: string) {
  const daysSinceMonday = (weekdayOf(date) + 6) % 7;
  return addDaysToDate(date, -daysSinceMonday);
}

export function weekEnd(date: string) {
  return addDaysToDate(weekStart(date), 6);
}

export function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string) {
  const [y, m] = date.split("-").map(Number);
  // Día 0 del mes siguiente = último día de este mes.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** Identifica el período (día, semana o mes de calendario) al que pertenece una fecha. */
export function periodKey(period: QuotaPeriod, date: string) {
  switch (period) {
    case "DAY":
      return date;
    case "WEEK":
      return weekStart(date);
    case "MONTH":
      return date.slice(0, 7);
  }
}

/**
 * Rango ampliado para poder contar cupos: incluye las semanas y los meses completos que tocan
 * el rango pedido (una semana puede empezar en el mes anterior).
 */
export function widenRange(from: string, to: string) {
  const start = [weekStart(from), monthStart(from)].sort()[0];
  const end = [weekEnd(to), monthEnd(to)].sort().at(-1)!;
  return { from: start, to: end };
}

/** Edad en años cumplidos a una fecha dada. */
export function ageInYears(birthDate: string, onDate: string) {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [oy, om, od] = onDate.split("-").map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

/** Itera las fechas YYYY-MM-DD entre dos extremos (incluidos). */
export function* eachDate(from: string, to: string) {
  for (let d = from; d <= to; d = addDaysToDate(d, 1)) yield d;
}
