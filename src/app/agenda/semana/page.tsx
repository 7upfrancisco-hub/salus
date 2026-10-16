import type { Metadata } from "next";
import Link from "next/link";
import { CoverageDot, CoverageTag, QuotaSummary, StatusBadge, timeRange } from "@/components/agenda-parts";
import { StaffShell } from "@/components/staff-shell";
import { getManageableProfessionals } from "@/lib/access";
import { buildRangeView, type DayView } from "@/lib/agenda-view";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { weekEnd, weekStart } from "@/lib/engine/periods";
import { SLOT_STATUS } from "@/lib/engine/types";
import { todayInZone } from "@/lib/time";
import { AgendaToolbar } from "../toolbar";

export const metadata: Metadata = { title: "Agenda semanal" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const WEEKDAY = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const shortDate = (date: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));

export default async function WeekAgendaPage({ searchParams }: PageProps<"/agenda/semana">) {
  const user = await requireStaff();
  const params = await searchParams;

  const [professionals, settings] = await Promise.all([
    getManageableProfessionals(user),
    db.centerSettings.findUnique({ where: { id: 1 } }),
  ]);
  const today = todayInZone(settings?.timezone ?? "America/Argentina/Buenos_Aires");

  if (professionals.length === 0) {
    return (
      <StaffShell user={user}>
        <p className="text-sm text-zinc-500">Todavía no tenés agendas asignadas.</p>
      </StaffShell>
    );
  }

  const professional = professionals.find((p) => p.id === first(params.profesional)) ?? professionals[0];
  const requestedDate = first(params.fecha);
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
  const from = weekStart(date);
  const to = weekEnd(date);

  const view = await buildRangeView(professional.id, from, to);

  return (
    <StaffShell user={user}>
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">{professional.name}</h1>
        <p className="text-sm text-zinc-500">
          {professional.specialty.name} · semana del {shortDate(from)} al {shortDate(to)}
        </p>
      </div>

      <AgendaToolbar basePath="/agenda/semana" professionals={professionals} professionalId={professional.id} date={date} stepDays={7} today={today} />

      {view && (
        <>
          <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Referencias de color">
            {view.coverages.map((c) => (
              <li key={c.id}>
                <CoverageDot coverage={c} />
              </li>
            ))}
          </ul>
          <div className="grid gap-3 lg:grid-cols-7">
            {view.days.map((day) => (
              <DayColumn key={day.date} day={day} professionalId={professional.id} view={view} today={today} />
            ))}
          </div>
        </>
      )}
    </StaffShell>
  );
}

function DayColumn({
  day,
  professionalId,
  view,
  today,
}: {
  day: DayView;
  professionalId: string;
  view: NonNullable<Awaited<ReturnType<typeof buildRangeView>>>;
  today: string;
}) {
  const coverageById = new Map(view.coverages.map((c) => [c.id, c]));
  const appointments = day.rows.flatMap((r) => (r.kind === "appointment" ? [r] : []));
  const attends = day.rows.length > 0;

  // Cuántos horarios libres le quedan a cada cobertura ese día.
  const freeByCoverage = new Map<string, number>();
  for (const row of day.rows) {
    if (row.kind !== "free") continue;
    for (const c of row.coverages) {
      if (c.status === SLOT_STATUS.AVAILABLE) freeByCoverage.set(c.coverageId, (freeByCoverage.get(c.coverageId) ?? 0) + 1);
    }
  }

  return (
    <section className={`rounded-xl border p-3 text-sm ${day.date === today ? "border-teal-600" : "border-zinc-200 dark:border-zinc-800"} ${attends ? "" : "opacity-60"}`}>
      <Link href={`/agenda?profesional=${professionalId}&fecha=${day.date}`} className="mb-2 block hover:underline">
        <span className="block font-semibold">{WEEKDAY[day.weekday]}</span>
        <span className="text-xs text-zinc-500">{shortDate(day.date)}</span>
      </Link>

      {day.closed && (
        <p className="mb-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
          {day.closed.kind === "HOLIDAY" ? "Feriado" : day.closed.kind === "LEAVE" ? "Licencia" : "Bloqueado"}
        </p>
      )}
      {!attends && !day.closed && <p className="text-xs text-zinc-500">No atiende</p>}

      {attends && day.quotas.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-xs">
          {day.quotas.map((q) => (
            <li key={q.coverageId}>
              <span className="font-medium" style={{ color: coverageById.get(q.coverageId)?.color }}>
                {coverageById.get(q.coverageId)?.name}
              </span>{" "}
              <QuotaSummary counters={q.counters} dayWord="día" />
            </li>
          ))}
        </ul>
      )}

      <ul className="space-y-1">
        {appointments.map(({ appointment: a }) => (
          <li key={a.id} className="rounded-md border-l-4 bg-zinc-50 px-2 py-1 dark:bg-zinc-900" style={{ borderLeftColor: a.coverage.color }}>
            <span className="block font-mono text-xs">{timeRange(a.startMinutes, a.endMinutes)}</span>
            <span className="block truncate font-medium">{a.patientName}</span>
            <span className="flex flex-wrap items-center gap-1">
              <CoverageTag coverage={a.coverage} className="!px-1.5 !py-0 !text-[10px]" />
              <StatusBadge status={a.status} />
              {a.isOverride && <span className="rounded-full bg-purple-100 px-1.5 text-[10px] font-medium text-purple-900">Override</span>}
            </span>
          </li>
        ))}
      </ul>

      {freeByCoverage.size > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          Libres:
          {[...freeByCoverage].map(([id, n]) => (
            <span key={id}>
              <span className="font-medium" style={{ color: coverageById.get(id)?.color }}>
                {coverageById.get(id)?.name}
              </span>{" "}
              {n}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
