import type { QuotaCounter } from "@/lib/engine/types";
import { APPOINTMENT_STATUS_LABEL } from "@/lib/status-labels";
import { minutesToTime } from "@/lib/time";
import type { CoverageInfo } from "@/lib/agenda-view";

const STATUS_STYLE: Record<string, string> = {
  RESERVED: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-green-100 text-green-800",
  CANCELLED: "bg-zinc-200 text-zinc-600",
  ATTENDED: "bg-sky-100 text-sky-900",
  NO_SHOW: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.CANCELLED}`}>
      {APPOINTMENT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function CoverageDot({ coverage }: { coverage: CoverageInfo }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: coverage.color }} />
      {coverage.name}
    </span>
  );
}

/** Etiqueta de color de una cobertura, para identificar el turno de un vistazo. */
export function CoverageTag({ coverage, className = "" }: { coverage: CoverageInfo; className?: string }) {
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold text-white ${className}`}
      style={{ backgroundColor: coverage.color }}
    >
      {coverage.name}
    </span>
  );
}

export const timeRange = (start: number, end: number) => `${minutesToTime(start)}–${minutesToTime(end)}`;

const PERIOD_WORD: Record<string, string> = { DAY: "hoy", WEEK: "semana", MONTH: "mes" };

/** "hoy 1/2 · semana 4/6": cuánto se usó de cada cupo que rige ese día. */
export function QuotaSummary({ counters, dayWord = "hoy" }: { counters: QuotaCounter[]; dayWord?: string }) {
  return (
    <span className="inline-flex flex-wrap gap-x-3">
      {counters.map((c) => (
        <span key={c.quotaId} className={c.full ? "font-semibold text-red-700" : ""}>
          {c.period === "DAY" ? dayWord : PERIOD_WORD[c.period]} {c.used}/{c.max}
          {c.scope !== "PROFESSIONAL" && <span className="text-xs font-normal text-zinc-500"> (compartido)</span>}
        </span>
      ))}
    </span>
  );
}
