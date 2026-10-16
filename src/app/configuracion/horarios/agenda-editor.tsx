"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { inputBase, secondaryButtonClass } from "@/components/ui";
import { minutesToTime, timeToMinutes, WEEKDAYS } from "@/lib/time";
import { saveAgenda } from "./actions";

export type BlockData = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
  officeId: string | null;
  validFrom: string | null;
  validTo: string | null;
};

type Row = {
  key: number;
  weekday: number;
  start: string;
  end: string;
  slot: string;
  officeId: string;
  validFrom: string;
  validTo: string;
};

let nextKey = 1;
const toRow = (b: BlockData): Row => ({
  key: nextKey++,
  weekday: b.weekday,
  start: minutesToTime(b.startMinutes),
  end: minutesToTime(b.endMinutes),
  slot: String(b.slotMinutes),
  officeId: b.officeId ?? "",
  validFrom: b.validFrom ?? "",
  validTo: b.validTo ?? "",
});

export function AgendaEditor({
  professionalId,
  offices,
  initialBlocks,
}: {
  professionalId: string;
  offices: { id: string; name: string }[];
  initialBlocks: BlockData[];
}) {
  const [rows, setRows] = useState<Row[]>(() => initialBlocks.map(toRow));

  const json = useMemo(
    () =>
      JSON.stringify(
        rows.map((r) => ({
          weekday: r.weekday,
          startMinutes: timeToMinutes(r.start) ?? -1,
          endMinutes: timeToMinutes(r.end) ?? -1,
          slotMinutes: Number(r.slot),
          officeId: r.officeId || null,
          validFrom: r.validFrom || null,
          validTo: r.validTo || null,
        })),
      ),
    [rows],
  );

  const update = (key: number, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = (weekday: number) =>
    setRows((all) => [
      ...all,
      { key: nextKey++, weekday, start: "09:00", end: "13:00", slot: "20", officeId: offices[0]?.id ?? "", validFrom: "", validTo: "" },
    ]);
  const remove = (key: number) => setRows((all) => all.filter((r) => r.key !== key));

  return (
    <ActionForm action={saveAgenda.bind(null, professionalId)} submitLabel="Guardar horarios">
      <input type="hidden" name="blocks" value={json} />

      <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {WEEKDAYS.map(({ value, label }) => {
          const dayRows = rows.filter((r) => r.weekday === value);
          return (
            <li key={value} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{label}</span>
                <button type="button" onClick={() => add(value)} className="text-sm text-teal-700 hover:underline">
                  + Agregar horario
                </button>
              </div>
              {dayRows.length === 0 ? (
                <p className="text-sm text-zinc-500">No atiende.</p>
              ) : (
                <ul className="space-y-3">
                  {dayRows.map((r) => (
                    <li key={r.key} className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="text-xs">
                          Desde
                          <input type="time" value={r.start} onChange={(e) => update(r.key, { start: e.target.value })} className={`${inputBase} mt-1 w-28`} />
                        </label>
                        <label className="text-xs">
                          Hasta
                          <input type="time" value={r.end} onChange={(e) => update(r.key, { end: e.target.value })} className={`${inputBase} mt-1 w-28`} />
                        </label>
                        <label className="text-xs">
                          Turnos de (min)
                          <input
                            type="number"
                            min={5}
                            max={240}
                            step={5}
                            value={r.slot}
                            onChange={(e) => update(r.key, { slot: e.target.value })}
                            className={`${inputBase} mt-1 w-24`}
                          />
                        </label>
                        <label className="text-xs">
                          Consultorio
                          <select value={r.officeId} onChange={(e) => update(r.key, { officeId: e.target.value })} className={`${inputBase} mt-1 w-40`}>
                            <option value="">Sin asignar</option>
                            {offices.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="button" onClick={() => remove(r.key)} className={`${secondaryButtonClass} text-red-700`} aria-label={`Quitar horario del ${label}`}>
                          Quitar
                        </button>
                      </div>
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-zinc-500">
                          Vigencia {r.validFrom || r.validTo ? `(${r.validFrom || "siempre"} → ${r.validTo || "siempre"})` : "(siempre)"}
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-3">
                          <label>
                            Rige desde
                            <input type="date" value={r.validFrom} onChange={(e) => update(r.key, { validFrom: e.target.value })} className={`${inputBase} mt-1 w-40`} />
                          </label>
                          <label>
                            Rige hasta
                            <input type="date" value={r.validTo} onChange={(e) => update(r.key, { validTo: e.target.value })} className={`${inputBase} mt-1 w-40`} />
                          </label>
                        </div>
                        <p className="mt-1 text-zinc-500">Sirve para cambios temporales de horario. Dejalo vacío si es permanente.</p>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </ActionForm>
  );
}
