"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { inputClass } from "@/components/ui";
import { ageInYears } from "@/lib/engine/periods";
import { capitalizeFirst } from "@/lib/time";
import type { AccountPerson } from "@/lib/patient-auth";
import type { ProfessionalOption, PublicAvailability, PublicSlot, SpecialtyOption } from "@/lib/public";
import {
  getAvailability,
  getProfessionals,
  getSpecialties,
  submitBooking,
  submitWaitlist,
  type BookingState,
  type WaitlistState,
} from "./actions";

type Coverage = { id: string; name: string; isParticular: boolean };
type Choice = { date: string; slot: PublicSlot };
type VisitType = "FIRST" | "CONTROL";

const bookingInitial: BookingState = {};
const waitlistInitial: WaitlistState = {};
const ANY = "ANY";
const DAYS_VISIBLE = 14;

const dayLabel = (date: string) =>
  capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`)),
  );
const longDay = (date: string) =>
  capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`)),
  );

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border px-4 py-2.5 text-left text-sm transition ${
        selected
          ? "border-teal-600 bg-teal-50 font-medium text-teal-900 ring-1 ring-teal-600 dark:bg-teal-950 dark:text-teal-100"
          : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-red-600">{message}</p> : null;
}

export function BookingWizard({ coverages, people }: { coverages: Coverage[]; people: AccountPerson[] }) {
  /** Para quién es el turno: el titular de la cuenta o una persona a cargo. */
  const [personId, setPersonId] = useState(people[0].patientId);
  const person = people.find((p) => p.patientId === personId) ?? people[0];
  const birthDate = person.birthDate;
  /** El paciente ya pidió ver la agenda (botón "Buscar turno"). */
  const [searched, setSearched] = useState(false);
  const [coverageId, setCoverageId] = useState<string | null>(null);
  const [specialties, setSpecialties] = useState<SpecialtyOption[] | null>(null);
  const [specialtyId, setSpecialtyId] = useState<string | null>(null);
  const [professionals, setProfessionals] = useState<ProfessionalOption[] | null>(null);
  const [professionalId, setProfessionalId] = useState<string | null>(null); // ANY o un id
  const [visitType, setVisitType] = useState<VisitType>("FIRST");
  const [availability, setAvailability] = useState<PublicAvailability | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAllDays, setShowAllDays] = useState(false);
  const [dayChosen, setDayChosen] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [showWaitlist, setShowWaitlist] = useState(false);

  const [bookingState, bookingAction, booking] = useActionState(submitBooking, bookingInitial);
  const [waitState, waitAction, joiningWaitlist] = useActionState(submitWaitlist, waitlistInitial);

  // Descarta respuestas de pedidos viejos si el paciente ya cambió de opción.
  const requestId = useRef(0);

  const coverage = coverages.find((c) => c.id === coverageId) ?? null;
  const specialty = specialties?.find((s) => s.id === specialtyId) ?? null;
  const hasAgeLimit = !!specialty && (specialty.minAgeYears !== null || specialty.maxAgeYears !== null);
  const age = ageInYears(birthDate, new Date().toISOString().slice(0, 10));
  const ageOutOfRange = !!specialty && ((specialty.minAgeYears !== null && age < specialty.minAgeYears) || (specialty.maxAgeYears !== null && age > specialty.maxAgeYears));
  const readyForProfessional = !!specialty && !ageOutOfRange;

  function resetBelowCoverage() {
    setSpecialties(null);
    setSpecialtyId(null);
    resetBelowSpecialty();
  }
  function resetBelowSpecialty() {
    setProfessionals(null);
    resetBelowProfessional();
  }
  function resetBelowProfessional() {
    setProfessionalId(null);
    clearSearch();
  }
  /** Descarta la agenda mostrada (otro médico, otra cobertura…): hay que volver a buscar. */
  function clearSearch() {
    setAvailability(null);
    setDayChosen(null);
    setChoice(null);
    setShowAllDays(false);
    setShowWaitlist(false);
    setSearched(false);
  }

  async function chooseCoverage(id: string) {
    const mine = ++requestId.current;
    setCoverageId(id);
    resetBelowCoverage();
    setLoading(true);
    const list = await getSpecialties(id);
    if (mine !== requestId.current) return;
    setSpecialties(list);
    setLoading(false);
  }

  /** Cambia la persona del turno: la edad cambia qué especialidades puede tomar, así que se empieza de nuevo. */
  function choosePerson(id: string) {
    setPersonId(id);
    setCoverageId(null);
    resetBelowCoverage();
    setLoading(false);
  }

  async function chooseSpecialty(id: string) {
    setSpecialtyId(id);
    resetBelowSpecialty();
    const target = specialties?.find((s) => s.id === id);
    // Una especialidad con límite de edad que la persona no cumple no ofrece profesionales.
    const outOfRange =
      !!target &&
      ((target.minAgeYears !== null && ageInYears(birthDate, new Date().toISOString().slice(0, 10)) < target.minAgeYears) ||
        (target.maxAgeYears !== null && ageInYears(birthDate, new Date().toISOString().slice(0, 10)) > target.maxAgeYears));
    if (outOfRange) return;
    await loadProfessionals(id);
  }

  async function loadProfessionals(forSpecialty: string) {
    if (!coverageId) return;
    const mine = ++requestId.current;
    setLoading(true);
    const list = await getProfessionals(coverageId, forSpecialty);
    if (mine !== requestId.current) return;
    setProfessionals(list);
    setLoading(false);
  }

  async function search(target: string, visit: VisitType, coverageOverride?: string) {
    const cov = coverageOverride ?? coverageId;
    if (!cov || !specialtyId) return;
    const mine = ++requestId.current;
    setLoading(true);
    clearSearch();
    setSearched(true);
    const result = await getAvailability({
      coverageId: cov,
      specialtyId,
      professionalId: target === ANY ? null : target,
      visitType: visit,
      patientId: person.patientId,
    });
    if (mine !== requestId.current) return;
    setAvailability(result);
    setLoading(false);
  }

  /** Elegir médico solo lo marca: la agenda se muestra al apretar "Buscar turno". */
  function chooseProfessional(target: string) {
    setProfessionalId(target);
    clearSearch();
  }

  /** Vuelve a buscar con lo ya elegido ("Actualizar horarios"). */
  async function refresh() {
    if (professionalId) await search(professionalId, visitType);
  }

  async function changeVisitType(next: VisitType) {
    setVisitType(next);
    if (professionalId) await search(professionalId, next);
  }

  async function switchToParticular(particularId: string) {
    setCoverageId(particularId);
    await search(professionalId ?? ANY, visitType, particularId);
  }

  const days = availability?.days ?? [];
  const visibleDays = showAllDays ? days : days.slice(0, DAYS_VISIBLE);
  const slotsOfDay = days.find((d) => d.date === dayChosen)?.slots ?? [];
  const firstSlot = days[0]?.slots[0];
  const requirements = choice ? (availability?.requirementsByProfessional[choice.slot.professionalId] ?? []) : [];
  const errors = bookingState.fieldErrors ?? {};

  // Numeración de los pasos: cambia según si hay que pedir la fecha de nacimiento, la lista de espera, etc.
  let stepNumber = 0;
  const nextStep = () => ++stepNumber;

  return (
    <div className="space-y-5">
      {people.length > 1 && (
        <Step n={nextStep()} title="¿Para quién es el turno?">
          <div className="flex flex-wrap gap-2">
            {people.map((p) => (
              <Option key={p.patientId} selected={p.patientId === personId} onClick={() => choosePerson(p.patientId)}>
                {p.name}
                {p.relation === "SELF" && <span className="block text-xs text-zinc-500">Yo</span>}
              </Option>
            ))}
          </div>
        </Step>
      )}

      <Step n={nextStep()} title="¿Con qué cobertura se atiende?">
        {coverages.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Por el momento no hay turnos online. Comunicate con el centro para consultar.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {coverages.map((c) => (
              <Option key={c.id} selected={c.id === coverageId} onClick={() => chooseCoverage(c.id)}>
                {c.name}
              </Option>
            ))}
          </div>
        )}
      </Step>

      {coverage && (
        <Step n={nextStep()} title="¿Qué especialidad necesitás?">
          {specialties === null ? (
            <p className="text-sm text-zinc-500">Buscando especialidades…</p>
          ) : specialties.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Por el momento no hay turnos online con {coverage.name}. Comunicate con el centro para consultar.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {specialties.map((s) => (
                <Option key={s.id} selected={s.id === specialtyId} onClick={() => chooseSpecialty(s.id)}>
                  {s.name}
                </Option>
              ))}
            </div>
          )}

          {specialty && hasAgeLimit && (
            <p className="mt-3 text-xs text-zinc-500">
              {specialty.name} atiende pacientes de {specialty.minAgeYears ?? 0} a {specialty.maxAgeYears ?? "…"} años.
            </p>
          )}
          {ageOutOfRange && specialty && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {people.length > 1 ? `${person.name} tiene` : "Tenés"} {age} años: esta especialidad no atiende esa edad.
            </p>
          )}
        </Step>
      )}

      {coverage && specialty && readyForProfessional && professionals && (
        <Step n={nextStep()} title="¿Con quién?">
          {professionals.length === 0 ? (
            <p className="text-sm text-zinc-600">No hay profesionales disponibles para esta combinación.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Option selected={professionalId === ANY} onClick={() => chooseProfessional(ANY)}>
                ⚡ Primero disponible
              </Option>
              {professionals.map((p) => (
                <Option key={p.id} selected={professionalId === p.id} onClick={() => chooseProfessional(p.id)}>
                  {p.name}
                </Option>
              ))}
            </div>
          )}
          {professionalId && !searched && (
            <button
              type="button"
              onClick={() => search(professionalId, visitType)}
              className="mt-4 w-full rounded-lg bg-teal-600 px-4 py-3 font-medium text-white transition hover:bg-teal-700 sm:w-auto"
            >
              Buscar turno
            </button>
          )}
        </Step>
      )}

      {searched && (
        <Step n={nextStep()} title="Elegí día y horario">
          {availability?.askVisitType && (
            <fieldset className="mb-4">
              <legend className="mb-1 text-sm font-medium">¿Ya te atendiste antes con este profesional?</legend>
              <div className="flex flex-wrap gap-2">
                <Option selected={visitType === "FIRST"} onClick={() => changeVisitType("FIRST")}>
                  No, es mi primera consulta
                </Option>
                <Option selected={visitType === "CONTROL"} onClick={() => changeVisitType("CONTROL")}>
                  Sí, es un control
                </Option>
              </div>
              <p className="mt-1 text-xs text-zinc-500">La primera consulta puede durar más, por eso cambian los horarios.</p>
            </fieldset>
          )}

          {availability === null || loading ? (
            <p className="text-sm text-zinc-500">Buscando turnos disponibles…</p>
          ) : days.length === 0 ? (
            <div className="space-y-3">
              <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                No hay turnos disponibles con {coverage?.name} por el momento.
              </p>
              {availability.particularAlternative && (
                <button
                  type="button"
                  onClick={() => switchToParticular(availability.particularAlternative!.coverageId)}
                  className="block w-full rounded-xl border border-teal-600 p-3 text-left text-sm hover:bg-teal-50 dark:hover:bg-teal-950"
                >
                  <strong>Ver turnos de atención particular</strong>
                  <span className="block text-zinc-600 dark:text-zinc-400">Hay turnos disponibles si te atendés de forma particular.</span>
                </button>
              )}
              {!showWaitlist && !waitState.ok && (
                <button
                  type="button"
                  onClick={() => setShowWaitlist(true)}
                  className="block w-full rounded-xl border border-zinc-300 p-3 text-left text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <strong>Anotarme en la lista de espera</strong>
                  <span className="block text-zinc-600 dark:text-zinc-400">Te avisamos por mail si se libera un turno.</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {firstSlot && !choice && (
                <button
                  type="button"
                  onClick={() => {
                    setDayChosen(days[0].date);
                    setChoice({ date: days[0].date, slot: firstSlot });
                  }}
                  className="w-full rounded-xl bg-teal-50 p-3 text-left text-sm ring-1 ring-teal-600 hover:bg-teal-100 dark:bg-teal-950"
                >
                  <span className="block text-xs font-medium uppercase tracking-wide text-teal-700 dark:text-teal-300">Próximo turno disponible</span>
                  <strong>{longDay(days[0].date)}</strong> · {firstSlot.time} hs
                  {professionalId === ANY && <span className="text-zinc-600 dark:text-zinc-400"> · {firstSlot.professionalName}</span>}
                </button>
              )}

              <div className="-mx-1 flex flex-wrap gap-2 px-1">
                {visibleDays.map((d) => (
                  <Option
                    key={d.date}
                    selected={d.date === dayChosen}
                    onClick={() => {
                      setDayChosen(d.date);
                      setChoice(null);
                    }}
                  >
                    {dayLabel(d.date)}
                  </Option>
                ))}
                {!showAllDays && days.length > DAYS_VISIBLE && (
                  <button type="button" onClick={() => setShowAllDays(true)} className="px-2 text-sm text-teal-700 hover:underline">
                    Ver más fechas
                  </button>
                )}
              </div>

              {dayChosen && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {slotsOfDay.map((slot) => {
                    const selected = choice?.date === dayChosen && choice.slot.startMinutes === slot.startMinutes && choice.slot.professionalId === slot.professionalId;
                    return (
                      <Option key={`${slot.professionalId}-${slot.startMinutes}`} selected={selected} onClick={() => setChoice({ date: dayChosen, slot })}>
                        <span className="block font-medium">{slot.time} hs</span>
                        {professionalId === ANY && <span className="block text-xs text-zinc-500">{slot.professionalName}</span>}
                      </Option>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {bookingState.slotTaken && (
            <div role="alert" className="mt-3 rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
              {bookingState.error}{" "}
              <button type="button" onClick={refresh} className="font-medium underline">
                Actualizar horarios
              </button>
            </div>
          )}
        </Step>
      )}

      {showWaitlist && coverage && specialty && (
        <Step n={nextStep()} title="Lista de espera">
          {waitState.ok ? (
            <p className="rounded-xl bg-green-50 p-4 text-sm text-green-900">
              ¡Listo! Te anotamos. Si se libera un turno te avisamos por mail.
            </p>
          ) : (
            <form action={waitAction} className="space-y-4">
              <input type="hidden" name="coverageId" value={coverage.id} />
              <input type="hidden" name="specialtyId" value={specialty.id} />
              {professionalId && professionalId !== ANY && <input type="hidden" name="professionalId" value={professionalId} />}
              <input type="hidden" name="patientId" value={person.patientId} />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Anotamos a <strong>{person.name}</strong>. Si se libera un turno, el aviso llega al mail de la cuenta.
              </p>
              {waitState.error && <p role="alert" className="text-sm text-red-600">{waitState.error}</p>}
              <button type="submit" disabled={joiningWaitlist} className="w-full rounded-lg bg-teal-600 px-4 py-3 font-medium text-white hover:bg-teal-700 disabled:opacity-60">
                {joiningWaitlist ? "Anotando…" : "Anotarme en la lista de espera"}
              </button>
            </form>
          )}
        </Step>
      )}

      {choice && coverage && (
        <Step n={nextStep()} title="Confirmá tu turno">
          <p className="mb-4 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
            <strong>{longDay(choice.date)}</strong> a las <strong>{choice.slot.time} hs</strong>
            <br />
            {choice.slot.professionalName} · {specialty?.name} · {coverage.name}
            <br />
            Paciente: <strong>{person.name}</strong>
          </p>

          {requirements.length > 0 && (
            <div className="mb-4 rounded-xl border border-teal-600 bg-teal-50 p-4 text-sm dark:bg-teal-950">
              <p className="mb-1 font-semibold text-teal-900 dark:text-teal-100">Para este turno tenés que traer:</p>
              <ul className="list-inside list-disc space-y-0.5">
                {requirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <form action={bookingAction} className="space-y-4">
            <input type="hidden" name="coverageId" value={coverage.id} />
            {specialty && <input type="hidden" name="specialtyId" value={specialty.id} />}
            <input type="hidden" name="professionalId" value={choice.slot.professionalId} />
            <input type="hidden" name="date" value={choice.date} />
            <input type="hidden" name="startMinutes" value={choice.slot.startMinutes} />
            <input type="hidden" name="patientId" value={person.patientId} />
            {!coverage.isParticular && (
              <div className="max-w-xs">
                <label htmlFor="affiliateNumber" className="mb-1 block text-sm font-medium">
                  Número de afiliado <span className="font-normal text-zinc-500">(opcional)</span>
                </label>
                <input
                  id="affiliateNumber"
                  name="affiliateNumber"
                  autoComplete="off"
                  maxLength={40}
                  defaultValue={bookingState.values?.affiliateNumber ?? person.affiliateNumber ?? ""}
                  className={inputClass}
                />
                <FieldError message={errors.affiliateNumber} />
              </div>
            )}
            <div>
              <label htmlFor="notes" className="mb-1 block text-sm font-medium">
                Comentarios <span className="font-normal text-zinc-500">(opcional)</span>
              </label>
              <textarea id="notes" name="notes" rows={2} maxLength={300} defaultValue={bookingState.values?.notes} className={inputClass} />
              <p className="mt-1 text-xs text-zinc-500">No escribas datos médicos: el equipo los consulta en la atención.</p>
            </div>
            {bookingState.error && !bookingState.slotTaken && (
              <p role="alert" className="text-sm text-red-600">
                {bookingState.error}
              </p>
            )}
            <button type="submit" disabled={booking} className="w-full rounded-lg bg-teal-600 px-4 py-3 font-medium text-white transition hover:bg-teal-700 disabled:opacity-60">
              {booking ? "Reservando…" : "Confirmar turno"}
            </button>
          </form>
        </Step>
      )}
    </div>
  );
}
