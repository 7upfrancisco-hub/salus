import { minutesToTime } from "@/lib/time";

const DAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const PERIOD_TEXT: Record<string, string> = { DAY: "por día", WEEK: "por semana", MONTH: "por mes" };
const SCOPE_TEXT: Record<string, string> = {
  PROFESSIONAL: "",
  SPECIALTY: " (compartido en la especialidad)",
  CENTER: " (compartido en todo el centro)",
};

type Window = { weekday: number; startMinutes: number; endMinutes: number };
type Quota = { period: string; max: number; scope: string; weekdays: number[] | null };

/** "lun, mié 09:00–11:00 · vie 14:00–16:00": las franjas agrupadas por horario. */
export function summarizeWindows(windows: Window[]) {
  if (windows.length === 0) return "Sin franjas";
  const byRange = new Map<string, number[]>();
  for (const w of windows) {
    const key = `${minutesToTime(w.startMinutes)}–${minutesToTime(w.endMinutes)}`;
    byRange.set(key, [...(byRange.get(key) ?? []), w.weekday]);
  }
  return [...byRange.entries()]
    .map(([range, days]) => `${DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_SHORT[d]).join(", ")} ${range}`)
    .join(" · ");
}

/** "máx. 2 por día · 6 por semana". */
export function summarizeQuotas(quotas: Quota[]) {
  if (quotas.length === 0) return "Sin cupos";
  return quotas
    .map((q) => {
      const days = q.weekdays && q.weekdays.length > 0 && q.weekdays.length < 7
        ? ` solo ${DAY_ORDER.filter((d) => q.weekdays!.includes(d)).map((d) => DAY_SHORT[d]).join(", ")}`
        : "";
      return `${q.max} ${PERIOD_TEXT[q.period] ?? q.period}${days}${SCOPE_TEXT[q.scope] ?? ""}`;
    })
    .join(" · ");
}
