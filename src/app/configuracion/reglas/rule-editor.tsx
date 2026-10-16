"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { inputBase, inputClass, secondaryButtonClass } from "@/components/ui";
import { summarizeQuotas, summarizeWindows } from "@/lib/rule-summary";
import { minutesToTime, timeToMinutes, WEEKDAYS } from "@/lib/time";
import { saveRule } from "./actions";

export type RuleData = {
  id: string | null;
  target: string;
  coverageId: string;
  active: boolean;
  notes: string;
  firstVisitMinutes: number | null;
  controlMinutes: number | null;
  windows: { weekday: number; startMinutes: number; endMinutes: number }[];
  quotas: { period: string; max: number; scope: string; weekdays: number[] }[];
  requirements: string[];
};

type Win = { key: number; weekday: number; start: string; end: string };
type Quota = { key: number; period: string; max: string; scope: string; weekdays: number[] };
type Req = { key: number; text: string };

let nextKey = 1;

const sectionClass = "rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800";

export function RuleEditor({
  rule,
  targets,
  coverages,
  canShare,
}: {
  rule: RuleData;
  targets: { value: string; label: string; group: string }[];
  coverages: { id: string; name: string }[];
  canShare: boolean;
}) {
  const [target, setTarget] = useState(rule.target);
  const [coverageId, setCoverageId] = useState(rule.coverageId);
  const [active, setActive] = useState(rule.active);
  const [notes, setNotes] = useState(rule.notes);
  const [first, setFirst] = useState(rule.firstVisitMinutes?.toString() ?? "");
  const [control, setControl] = useState(rule.controlMinutes?.toString() ?? "");
  const [windows, setWindows] = useState<Win[]>(() =>
    rule.windows.map((w) => ({ key: nextKey++, weekday: w.weekday, start: minutesToTime(w.startMinutes), end: minutesToTime(w.endMinutes) })),
  );
  const [quotas, setQuotas] = useState<Quota[]>(() => rule.quotas.map((q) => ({ key: nextKey++, period: q.period, max: String(q.max), scope: q.scope, weekdays: q.weekdays })));
  const [requirements, setRequirements] = useState<Req[]>(() => rule.requirements.map((text) => ({ key: nextKey++, text })));

  const payload = useMemo(
    () => ({
      target,
      coverageId,
      active,
      notes: notes.trim() || null,
      firstVisitMinutes: first ? Number(first) : null,
      controlMinutes: control ? Number(control) : null,
      windows: windows.map((w) => ({ weekday: w.weekday, startMinutes: timeToMinutes(w.start) ?? -1, endMinutes: timeToMinutes(w.end) ?? -1 })),
      quotas: quotas.map((q) => ({ period: q.period, max: Number(q.max), scope: q.scope, weekdays: q.weekdays })),
      requirements: requirements.map((r) => r.text).filter((t) => t.trim()),
    }),
    [target, coverageId, active, notes, first, control, windows, quotas, requirements],
  );

  const coverageName = coverages.find((c) => c.id === coverageId)?.name ?? "—";
  const groups = [...new Set(targets.map((t) => t.group))];

  const updateWin = (key: number, patch: Partial<Win>) => setWindows((all) => all.map((w) => (w.key === key ? { ...w, ...patch } : w)));
  const updateQuota = (key: number, patch: Partial<Quota>) => setQuotas((all) => all.map((q) => (q.key === key ? { ...q, ...patch } : q)));

  return (
    <ActionForm action={saveRule.bind(null, rule.id)} submitLabel={rule.id ? "Guardar cambios" : "Crear regla"} className="space-y-6">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <section className={`${sectionClass} grid gap-4 sm:grid-cols-2`}>
        <label className="text-sm font-medium">
          ¿Para quién es?
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${inputClass} mt-1 font-normal`}>
            <option value="">Elegí…</option>
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {targets.filter((t) => t.group === group).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Cobertura
          <select value={coverageId} onChange={(e) => setCoverageId(e.target.value)} className={`${inputClass} mt-1 font-normal`}>
            <option value="">Elegí…</option>
            {coverages.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="mt-1 h-4 w-4 accent-teal-600" />
          <span>
            <span className="block text-sm font-medium">Regla activa</span>
            <span className="block text-xs text-zinc-500">Si la desactivás, el profesional deja de atender esta cobertura (no se ofrece ningún turno).</span>
          </span>
        </label>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">Franjas horarias</h2>
        <p className="mb-3 text-sm text-zinc-500">
          En qué días y horarios se atiende esta cobertura. Tienen que estar dentro del horario de atención del profesional.
        </p>
        <ul className="space-y-3">
          {WEEKDAYS.map(({ value, label }) => {
            const dayWindows = windows.filter((w) => w.weekday === value);
            return (
              <li key={value} className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <span className="w-24 pt-2 text-sm font-medium">{label}</span>
                <div className="flex-1 space-y-2">
                  {dayWindows.length === 0 && <span className="block pt-2 text-sm text-zinc-500">No se atiende</span>}
                  {dayWindows.map((w) => (
                    <div key={w.key} className="flex flex-wrap items-center gap-2">
                      <input type="time" aria-label={`${label}: desde`} value={w.start} onChange={(e) => updateWin(w.key, { start: e.target.value })} className={`${inputBase} w-28`} />
                      <span className="text-zinc-500">a</span>
                      <input type="time" aria-label={`${label}: hasta`} value={w.end} onChange={(e) => updateWin(w.key, { end: e.target.value })} className={`${inputBase} w-28`} />
                      <button type="button" onClick={() => setWindows((all) => all.filter((x) => x.key !== w.key))} className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" aria-label={`Quitar franja del ${label}`}>
                        ✕
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setWindows((all) => [...all, { key: nextKey++, weekday: value, start: "09:00", end: "11:00" }])} className="text-sm text-teal-700 hover:underline">
                    + {dayWindows.length === 0 ? "Atender este día" : "Agregar otra franja"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">Cupos</h2>
        <p className="mb-3 text-sm text-zinc-500">
          Cuántos turnos se pueden dar con esta cobertura. Podés combinar varios (por ejemplo, 2 por día <em>y</em> 6 por semana).
          Los turnos cancelados liberan el cupo; los ausentes lo consumen.
        </p>
        <ul className="space-y-3">
          {quotas.map((q) => (
            <li key={q.key} className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs">
                  Máximo
                  <input type="number" min={1} max={1000} value={q.max} onChange={(e) => updateQuota(q.key, { max: e.target.value })} className={`${inputBase} mt-1 w-24`} />
                </label>
                <label className="text-xs">
                  Por
                  <select value={q.period} onChange={(e) => updateQuota(q.key, { period: e.target.value })} className={`${inputBase} mt-1 w-32`}>
                    <option value="DAY">día</option>
                    <option value="WEEK">semana</option>
                    <option value="MONTH">mes</option>
                  </select>
                </label>
                {canShare ? (
                  <label className="text-xs">
                    Quién lo comparte
                    <select value={q.scope} onChange={(e) => updateQuota(q.key, { scope: e.target.value })} className={`${inputBase} mt-1 w-56`}>
                      <option value="PROFESSIONAL">Cada profesional el suyo</option>
                      <option value="SPECIALTY">Todos los de la especialidad</option>
                      <option value="CENTER">Todo el centro</option>
                    </select>
                  </label>
                ) : null}
                <button type="button" onClick={() => setQuotas((all) => all.filter((x) => x.key !== q.key))} className={`${secondaryButtonClass} text-red-700`}>
                  Quitar
                </button>
              </div>
              <fieldset className="mt-3">
                <legend className="mb-1 text-xs text-zinc-500">Rige solo estos días (si no marcás ninguno, rige todos)</legend>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map(({ value, label }) => {
                    const on = q.weekdays.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => updateQuota(q.key, { weekdays: on ? q.weekdays.filter((d) => d !== value) : [...q.weekdays, value] })}
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-teal-600 bg-teal-600 text-white" : "border-zinc-300 dark:border-zinc-700"}`}
                      >
                        {label.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setQuotas((all) => [...all, { key: nextKey++, period: "DAY", max: "2", scope: "PROFESSIONAL", weekdays: [] }])} className="mt-3 text-sm text-teal-700 hover:underline">
          + Agregar un cupo
        </button>
        {quotas.length === 0 && <p className="mt-2 text-sm text-zinc-500">Sin cupos: no hay límite de turnos para esta cobertura.</p>}
      </section>

      <section className={`${sectionClass} grid gap-4 sm:grid-cols-2`}>
        <div className="sm:col-span-2">
          <h2 className="text-lg font-semibold">Duración especial</h2>
          <p className="text-sm text-zinc-500">Opcional. Si lo dejás vacío se usa la duración de los turnos del horario de atención.</p>
        </div>
        <label className="text-sm font-medium">
          Primera vez (minutos)
          <input type="number" min={5} max={480} step={5} value={first} onChange={(e) => setFirst(e.target.value)} className={`${inputClass} mt-1 font-normal`} />
        </label>
        <label className="text-sm font-medium">
          Control (minutos)
          <input type="number" min={5} max={480} step={5} value={control} onChange={(e) => setControl(e.target.value)} className={`${inputClass} mt-1 font-normal`} />
        </label>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">Requisitos para el paciente</h2>
        <p className="mb-3 text-sm text-zinc-500">Se le muestran antes de confirmar y en el mail (por ejemplo: «Orden PAMI vigente», «DNI y credencial»).</p>
        <ul className="space-y-2">
          {requirements.map((r) => (
            <li key={r.key} className="flex gap-2">
              <input
                value={r.text}
                maxLength={120}
                onChange={(e) => setRequirements((all) => all.map((x) => (x.key === r.key ? { ...x, text: e.target.value } : x)))}
                className={inputClass}
                aria-label="Requisito"
              />
              <button type="button" onClick={() => setRequirements((all) => all.filter((x) => x.key !== r.key))} className="rounded-md px-2 text-zinc-500 hover:text-red-600" aria-label="Quitar requisito">
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setRequirements((all) => [...all, { key: nextKey++, text: "" }])} className="mt-3 text-sm text-teal-700 hover:underline">
          + Agregar requisito
        </button>
      </section>

      <section className={sectionClass}>
        <label className="text-sm font-medium">
          Notas internas <span className="font-normal text-zinc-500">(solo las ve el personal)</span>
          <input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} mt-1 font-normal`} />
        </label>
      </section>

      <p className="rounded-xl bg-teal-50 p-4 text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100">
        <strong>Resumen — {coverageName}:</strong> {summarizeWindows(payload.windows.filter((w) => w.startMinutes >= 0))}. Cupos: {summarizeQuotas(payload.quotas.map((q) => ({ ...q, weekdays: q.weekdays })))}.
      </p>
    </ActionForm>
  );
}
