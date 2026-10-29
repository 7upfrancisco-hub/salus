"use client";

import { useActionState, useState, useTransition } from "react";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { createStaffAppointment, lookupPatient, type StaffBookingState } from "../actions";

export type CoverageOption = {
  id: string;
  name: string;
  color: string;
  isParticular: boolean;
  /** Reglas que este horario incumple para esa cobertura (vacío = disponible). */
  problems: { label: string; overridable: boolean }[];
};

const initialState: StaffBookingState = {};

type Fields = {
  dni: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  phone: string;
  affiliateNumber: string;
};
const emptyFields: Fields = { dni: "", firstName: "", lastName: "", birthDate: "", email: "", phone: "", affiliateNumber: "" };

export function StaffBookingForm({
  professionalId,
  date,
  startMinutes,
  coverages,
  preselectedCoverageId,
}: {
  professionalId: string;
  date: string;
  startMinutes: number;
  coverages: CoverageOption[];
  preselectedCoverageId?: string;
}) {
  const [state, action, pending] = useActionState(createStaffAppointment, initialState);
  const [coverageId, setCoverageId] = useState(preselectedCoverageId ?? "");
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [overrideReason, setOverrideReason] = useState("");
  const [lookup, setLookup] = useState<"idle" | "found" | "new">("idle");
  const [searching, startSearch] = useTransition();
  const errors = state.fieldErrors ?? {};

  const selected = coverages.find((c) => c.id === coverageId);
  const problems = selected?.problems ?? [];
  const blocking = problems.filter((p) => !p.overridable);
  const needsOverride = problems.length > 0 || !!state.needsOverride;
  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [key]: e.target.value }));

  function search() {
    startSearch(async () => {
      const result = await lookupPatient(fields.dni);
      if (result.found && result.patient) {
        const p = result.patient;
        setFields((f) => ({
          ...f,
          firstName: p.firstName,
          lastName: p.lastName,
          birthDate: p.birthDate,
          email: p.email ?? "",
          phone: p.phone,
          affiliateNumber: p.affiliateNumber ?? "",
        }));
        setLookup("found");
      } else {
        setLookup("new");
      }
    });
  }

  const textField = (id: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input id={id} name={id} value={fields[id]} onChange={set(id)} required={props.required ?? true} className={inputClass} {...props} />
      {errors[id] && <p className="mt-1 text-xs text-red-600">{errors[id]}</p>}
    </div>
  );

  return (
    <form action={action} className="max-w-3xl space-y-6">
      <input type="hidden" name="professionalId" value={professionalId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="startMinutes" value={startMinutes} />

      <fieldset className="space-y-2 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <legend className="px-2 text-base font-semibold">Cobertura</legend>
        <input type="hidden" name="coverageId" value={coverageId} />
        <div className="grid gap-2 sm:grid-cols-2">
          {coverages.map((c) => {
            const ok = c.problems.length === 0;
            const checked = c.id === coverageId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCoverageId(c.id)}
                aria-pressed={checked}
                className={`rounded-xl border p-3 text-left text-sm transition ${checked ? "ring-2" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"} border-zinc-300 dark:border-zinc-700`}
                style={checked ? { borderColor: c.color, boxShadow: `0 0 0 2px ${c.color}` } : undefined}
              >
                <span className="flex items-center gap-2 font-medium">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                  {c.name}
                </span>
                <span className={`mt-1 block text-xs ${ok ? "text-green-700" : "text-amber-800"}`}>
                  {ok ? "Disponible en este horario" : c.problems.map((p) => p.label).join(" · ")}
                </span>
              </button>
            );
          })}
        </div>
        {errors.coverageId && <p className="text-xs text-red-600">{errors.coverageId}</p>}
      </fieldset>

      {needsOverride && selected && (
        <fieldset className="space-y-3 rounded-2xl border border-purple-300 bg-purple-50 p-5 dark:border-purple-900 dark:bg-purple-950">
          <legend className="px-2 text-base font-semibold text-purple-900 dark:text-purple-100">Saltear reglas (override)</legend>
          <p className="text-sm text-purple-900 dark:text-purple-100">
            Este horario no cumple las reglas de {selected.name}: <strong>{problems.map((p) => p.label).join("; ")}</strong>.
            {blocking.length > 0
              ? " Hay reglas que no se pueden saltear: se corrigen desde la configuración (licencias, feriados, edad, cobertura no atendida)."
              : " Podés darlo igual, pero queda registrado quién lo hizo y por qué."}
          </p>
          {blocking.length === 0 && (
            <div>
              <label htmlFor="overrideReason" className="mb-1 block text-sm font-medium">
                Motivo (obligatorio)
              </label>
              <input
                id="overrideReason"
                name="overrideReason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                required
                minLength={5}
                maxLength={300}
                className={inputClass}
                placeholder="Ej.: derivación urgente indicada por el profesional"
              />
            </div>
          )}
        </fieldset>
      )}

      <fieldset className="space-y-4 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <legend className="px-2 text-base font-semibold">Paciente</legend>
        <div className="flex items-end gap-2">
          <div className="flex-1">{textField("dni", "DNI", { inputMode: "numeric", autoComplete: "off", placeholder: "Sin puntos" })}</div>
          <button type="button" onClick={search} disabled={searching || fields.dni.length < 6} className={secondaryButtonClass}>
            {searching ? "Buscando…" : "Buscar"}
          </button>
        </div>
        {lookup === "found" && <p className="text-sm text-green-700">Paciente encontrado. Revisá que los datos de contacto estén al día.</p>}
        {lookup === "new" && <p className="text-sm text-zinc-500">No hay un paciente con ese DNI: completá los datos para registrarlo.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("firstName", "Nombre")}
          {textField("lastName", "Apellido")}
          {textField("birthDate", "Fecha de nacimiento", { type: "date", max: new Date().toISOString().slice(0, 10) })}
          {textField("phone", "Teléfono", { type: "tel" })}
          {textField("email", "Email", { type: "email" })}
          {!selected?.isParticular && textField("affiliateNumber", "Número de afiliado", { required: false })}
        </div>
        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium">
            Comentarios <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <input id="notes" name="notes" maxLength={300} className={inputClass} />
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !coverageId || blocking.length > 0 || (needsOverride && overrideReason.trim().length < 5)}
        className={primaryButtonClass}
      >
        {pending ? "Guardando…" : needsOverride ? "Dar turno con override" : "Dar turno"}
      </button>
    </form>
  );
}
