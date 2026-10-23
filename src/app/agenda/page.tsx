import type { Metadata } from "next";
import Link from "next/link";
import { CoverageDot, CoverageTag, QuotaSummary, StatusBadge, timeRange } from "@/components/agenda-parts";
import { StaffShell } from "@/components/staff-shell";
import { cardClass, secondaryButtonClass } from "@/components/ui";
import { getManageableProfessionals } from "@/lib/access";
import { buildRangeView, type AgendaRow, type CoverageInfo, type DayView } from "@/lib/agenda-view";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { SLOT_STATUS } from "@/lib/engine/types";
import { SLOT_STATUS_LABEL, VISIT_TYPE_LABEL } from "@/lib/status-labels";
import { capitalizeFirst, todayInZone } from "@/lib/time";
import { AgendaToolbar } from "./toolbar";
import { AppointmentActions } from "./appointment-actions";

export const metadata: Metadata = { title: "Agenda del día" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const dateLabel = (date: string) =>
  capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
      new Date(`${date}T00:00:00Z`),
    ),
  );

export default async function DayAgendaPage({ searchParams }: PageProps<"/agenda">) {
  const user = await requireStaff();
  const params = await searchParams;

  const [professionals, settings, occupationalCoverages] = await Promise.all([
    getManageableProfessionals(user),
    db.centerSettings.findUnique({ where: { id: 1 } }),
    db.coverage.count({ where: { isOccupational: true, active: true } }),
  ]);
  const today = todayInZone(settings?.timezone ?? "America/Argentina/Buenos_Aires");

  if (professionals.length === 0) {
    return (
      <StaffShell user={user}>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Agenda del día</h1>
        <p className="text-sm text-zinc-500">
          Todavía no tenés agendas asignadas. Pedile a un administrador que te asigne profesionales.
        </p>
      </StaffShell>
    );
  }

  const requested = first(params.profesional);
  const professional = professionals.find((p) => p.id === requested) ?? professionals[0];
  const requestedDate = first(params.fecha);
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;

  const view = await buildRangeView(professional.id, date, date);
  const day = view?.days[0];
  const now = new Date().getTime();

  return (
    <StaffShell user={user}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{professional.name}</h1>
          <p className="text-sm text-zinc-500">
            {professional.specialty.name} · {dateLabel(date)}
          </p>
        </div>
        <Link
          href={`/agenda/semana?profesional=${professional.id}&fecha=${date}`}
          className="text-sm text-teal-700 hover:underline"
        >
          Ver la semana →
        </Link>
      </div>

      <AgendaToolbar
        basePath="/agenda"
        professionals={professionals}
        professionalId={professional.id}
        date={date}
        stepDays={1}
        today={today}
      />

      <div className="-mt-3 mb-6 flex flex-wrap gap-2">
        <a href={`/agenda/descargar?profesional=${professional.id}&fecha=${date}`} className={secondaryButtonClass}>
          Descargar agenda del día (PDF)
        </a>
        {occupationalCoverages > 0 && (
          <a href={`/agenda/descargar?tipo=preocupacional&fecha=${date}`} className={secondaryButtonClass}>
            Descargar preocupacionales del día (PDF)
          </a>
        )}
      </div>

      {!view || !day ? (
        <p className="text-sm text-zinc-500">No se pudo cargar la agenda.</p>
      ) : (
        <DayBody view={{ professionalId: professional.id, coverages: view.coverages }} day={day} now={now} isToday={date === today} />
      )}
    </StaffShell>
  );
}

function DayBody({
  view,
  day,
  now,
  isToday,
}: {
  view: { professionalId: string; coverages: CoverageInfo[] };
  day: DayView;
  now: number;
  isToday: boolean;
}) {
  const coverageById = new Map(view.coverages.map((c) => [c.id, c]));
  const hasGrid = day.rows.length > 0;

  return (
    <div className="space-y-6">
      {day.closed && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Sin atención este día:</strong>{" "}
          {day.closed.kind === "HOLIDAY" ? "feriado" : day.closed.kind === "LEAVE" ? "licencia" : "bloqueo"}
          {day.closed.note ? ` — ${day.closed.note}` : ""}
        </div>
      )}

      {(day.windows.length > 0 || day.quotas.length > 0) && (
        <section className={`${cardClass} grid gap-4 md:grid-cols-2`}>
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Franjas por cobertura</h2>
            {day.windows.length === 0 ? (
              <p className="text-sm text-zinc-500">Ninguna cobertura tiene franja este día.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {day.windows.map((w, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CoverageDot coverage={coverageById.get(w.coverageId)!} />
                    <span className="text-zinc-600 dark:text-zinc-400">{timeRange(w.startMinutes, w.endMinutes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Cupos usados</h2>
            {day.quotas.length === 0 ? (
              <p className="text-sm text-zinc-500">Sin cupos que rijan este día.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {day.quotas.map((q) => (
                  <li key={q.coverageId} className="flex flex-wrap items-center gap-x-3">
                    <CoverageDot coverage={coverageById.get(q.coverageId)!} />
                    <QuotaSummary counters={q.counters} dayWord={isToday ? "hoy" : "día"} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {!hasGrid ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Este profesional no atiende este día.
        </p>
      ) : (
        <ul className="space-y-2">
          {day.rows.map((row) => (
            <li key={`${row.kind}-${row.startMinutes}-${row.kind === "appointment" ? row.appointment.id : ""}`}>
              {row.kind === "appointment" ? (
                <AppointmentRow row={row} now={now} />
              ) : (
                <FreeRow row={row} professionalId={view.professionalId} date={day.date} coverageById={coverageById} />
              )}
            </li>
          ))}
        </ul>
      )}

      {day.cancelled.length > 0 && (
        <details className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">Turnos cancelados ({day.cancelled.length})</summary>
          <ul className="mt-3 space-y-2">
            {day.cancelled.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 text-zinc-600 dark:text-zinc-400">
                <span className="font-mono">{timeRange(a.startMinutes, a.endMinutes)}</span>
                <span>{a.patientName}</span>
                <CoverageTag coverage={a.coverage} />
                {a.cancelReason && <span className="text-xs">«{a.cancelReason}»</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AppointmentRow({ row, now }: { row: Extract<AgendaRow, { kind: "appointment" }>; now: number }) {
  const a = row.appointment;
  return (
    <details className="group rounded-xl border border-zinc-200 dark:border-zinc-800" style={{ borderLeft: `5px solid ${a.coverage.color}` }}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <span className="w-28 shrink-0 font-mono text-sm">{timeRange(a.startMinutes, a.endMinutes)}</span>
        <span className="min-w-0 flex-1 font-medium">{a.patientName}</span>
        <CoverageTag coverage={a.coverage} />
        <StatusBadge status={a.status} />
        {a.isOverride && (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-900" title={a.overrideReason ?? ""}>
            Override
          </span>
        )}
      </summary>
      <div className="border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <div><dt className="inline text-zinc-500">DNI: </dt><dd className="inline">{a.dni}</dd></div>
          <div><dt className="inline text-zinc-500">Teléfono: </dt><dd className="inline">{a.phone}</dd></div>
          {a.email && <div><dt className="inline text-zinc-500">Email: </dt><dd className="inline">{a.email}</dd></div>}
          {a.affiliateNumber && <div><dt className="inline text-zinc-500">Afiliado: </dt><dd className="inline">{a.affiliateNumber}</dd></div>}
          {a.studyName && <div><dt className="inline text-zinc-500">Estudio: </dt><dd className="inline">{a.studyName}</dd></div>}
          {a.company && <div><dt className="inline text-zinc-500">Empresa: </dt><dd className="inline">{a.company}</dd></div>}
          <div><dt className="inline text-zinc-500">Tipo: </dt><dd className="inline">{VISIT_TYPE_LABEL[a.visitType] ?? a.visitType}</dd></div>
          {a.officeName && <div><dt className="inline text-zinc-500">Consultorio: </dt><dd className="inline">{a.officeName}</dd></div>}
          <div><dt className="inline text-zinc-500">Reservado: </dt><dd className="inline">{a.source === "PUBLIC" ? "online por el paciente" : `por ${a.createdByName ?? "secretaría"}`}</dd></div>
          {a.notes && <div className="sm:col-span-2"><dt className="inline text-zinc-500">Comentarios: </dt><dd className="inline">{a.notes}</dd></div>}
        </dl>
        {a.isOverride && (
          <p className="mt-2 rounded-lg bg-purple-50 p-2 text-xs text-purple-900">
            <strong>Reglas salteadas:</strong> {a.overrideRules.map((r) => SLOT_STATUS_LABEL[r]).join("; ")}.<br />
            <strong>Motivo:</strong> {a.overrideReason} <span className="opacity-70">— {a.createdByName ?? "sin dato"}</span>
          </p>
        )}
        <AppointmentActions appointmentId={a.id} status={a.status} started={a.startsAtMs <= now} />
      </div>
    </details>
  );
}

function FreeRow({
  row,
  professionalId,
  date,
  coverageById,
}: {
  row: Extract<AgendaRow, { kind: "free" }>;
  professionalId: string;
  date: string;
  coverageById: Map<string, CoverageInfo>;
}) {
  const link = (coverageId?: string) =>
    `/agenda/nuevo?profesional=${professionalId}&fecha=${date}&hora=${row.startMinutes}${coverageId ? `&cobertura=${coverageId}` : ""}`;

  const allPast = row.coverages.every((c) => c.violations.includes(SLOT_STATUS.PAST));
  const closed = row.coverages.every((c) => c.violations.includes(SLOT_STATUS.EXCEPTION));
  // Coberturas cuya franja incluye este horario: las únicas que tienen sentido mostrar.
  const inWindow = row.coverages.filter(
    (c) => !c.violations.includes(SLOT_STATUS.OUTSIDE_WINDOW) && !c.violations.includes(SLOT_STATUS.NO_RULE),
  );

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 dark:border-zinc-700 ${allPast || closed ? "opacity-50" : ""}`}>
      <span className="w-28 shrink-0 font-mono text-sm text-zinc-500">{timeRange(row.startMinutes, row.endMinutes)}</span>
      <span className="text-sm text-zinc-500">Libre{row.officeName ? ` · ${row.officeName}` : ""}</span>

      <div className="flex flex-1 flex-wrap items-center gap-2">
        {allPast ? (
          <span className="text-xs text-zinc-500">Horario pasado</span>
        ) : closed ? (
          <span className="text-xs text-zinc-500">Sin atención</span>
        ) : inWindow.length === 0 ? (
          <span className="text-xs text-zinc-500">Sin cobertura asignada a esta franja</span>
        ) : (
          inWindow.map((c) => {
            const coverage = coverageById.get(c.coverageId)!;
            return c.status === SLOT_STATUS.AVAILABLE ? (
              <Link
                key={c.coverageId}
                href={link(c.coverageId)}
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-white hover:opacity-85"
                style={{ backgroundColor: coverage.color }}
              >
                {coverage.name}
              </Link>
            ) : (
              <span
                key={c.coverageId}
                title={c.violations.map((v) => SLOT_STATUS_LABEL[v]).join("; ")}
                className="rounded-md border border-dashed px-2.5 py-1 text-xs text-zinc-500"
                style={{ borderColor: coverage.color }}
              >
                {coverage.name} · {SLOT_STATUS_LABEL[c.status].toLowerCase()}
              </span>
            );
          })
        )}
      </div>

      {!allPast && !closed && (
        <Link href={link()} className="text-xs text-teal-700 hover:underline">
          Dar turno…
        </Link>
      )}
    </div>
  );
}
