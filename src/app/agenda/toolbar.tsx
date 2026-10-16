import Link from "next/link";
import { addDaysToDate } from "@/lib/time";

type Professional = { id: string; name: string; specialty: { name: string } };

const chip = "rounded-full border px-3 py-1 text-sm transition";

/** Selector de profesional y navegación por fecha, compartido por la vista diaria y la semanal. */
export function AgendaToolbar({
  basePath,
  professionals,
  professionalId,
  date,
  stepDays,
  today,
}: {
  basePath: string;
  professionals: Professional[];
  professionalId: string;
  date: string;
  stepDays: number;
  today: string;
}) {
  const href = (d: string, p = professionalId) => `${basePath}?profesional=${p}&fecha=${d}`;

  return (
    <div className="mb-6 space-y-3">
      {professionals.length > 1 && (
        <nav aria-label="Elegir profesional" className="flex flex-wrap gap-2">
          {professionals.map((p) => (
            <Link
              key={p.id}
              href={href(date, p.id)}
              className={`${chip} ${
                p.id === professionalId
                  ? "border-teal-600 bg-teal-600 text-white"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              }`}
            >
              {p.name} <span className="opacity-70">· {p.specialty.name}</span>
            </Link>
          ))}
        </nav>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={href(addDaysToDate(date, -stepDays))} className={`${chip} border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`} aria-label="Anterior">
          ←
        </Link>
        <Link href={href(today)} className={`${chip} border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`}>
          Hoy
        </Link>
        <Link href={href(addDaysToDate(date, stepDays))} className={`${chip} border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`} aria-label="Siguiente">
          →
        </Link>
        <form method="get" action={basePath} className="flex items-center gap-2">
          <input type="hidden" name="profesional" value={professionalId} />
          <input
            type="date"
            name="fecha"
            defaultValue={date}
            aria-label="Ir a la fecha"
            className="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
          />
          <button type="submit" className={`${chip} border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`}>
            Ir
          </button>
        </form>
      </div>
    </div>
  );
}
