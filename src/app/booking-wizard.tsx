"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { inputClass } from "@/components/ui";
import { ageInYears } from "@/lib/engine/periods";
import { mergeRequirements, studyInstructionLines } from "@/lib/studies";
import { capitalizeFirst } from "@/lib/time";
import type { OccupationalOffer, ProfessionalOption, PublicAvailability, PublicSlot, SpecialtyOption } from "@/lib/public";
import {
  getAvailability,
  getOccupationalAvailability,
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
/** Personal: cobertura → especialidad → médico. Preocupacional: estudio → agenda (sin obra social). */
type Kind = "PERSONAL" | "OCCUPATIONAL";

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

export function BookingWizard({ coverages, occupational }: { coverages: Coverage[]; occupational: OccupationalOffer | null }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [studyId, setStudyId] = useState<string | null>(null);
  /** El paciente ya pidió ver la agenda (botón "Buscar turno" o, en preocupacional, al elegir el estudio). */
  const [searched, setSearched] = useState(false);
  const [coverageId, setCoverageId] = useState<string | null>(null);
  const [specialties, setSpecialties] = useState<SpecialtyOption[] | null>(null);
  const [specialtyId, setSpecialtyId] = useState<string | null>(null);
  const [birthDate, setBirthDate] = useState("");
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
  const isOccupational = kind === "OCCUPATIONAL";
  const study = occupational?.studies.find((s) => s.id === studyId) ?? null;
  // La cobertura con la que se reserva: la elegida (personal) o la de preocupacional.
  const bookingCoverage: Coverage | null =
    isOccupational && occupational ? { id: occupational.coverageId, name: "Preocupacional", isParticular: false } : coverage;
  const specialty = specialties?.find((s) => s.id === specialtyId) ?? null;
  const hasAgeLimit = !!specialty && (specialty.minAgeYears !== null || specialty.maxAgeYears !== null);
  const birthDateValid = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && birthDate >= "1900-01-01" && birthDate <= new Date().toISOString().slice(0, 10);
  const age = birthDateValid ? ageInYears(birthDate, new Date().toISOString().slice(0, 10)) : null;
  const ageOutOfRange =
    !!specialty && age !== null && ((specialty.minAgeYears !== null && age < specialty.minAgeYears) || (specialty.maxAgeYears !== null && age > specialty.maxAgeYears));
  const readyForProfessional = !!specialty && (!hasAgeLimit || (birthDateValid && !ageOutOfRange));

  function resetBelowCoverage() {
    setSpecialties(null);
    setSpecialtyId(null);
    resetBelowSpecialty();
  }
  function resetBelowSpecialty() {
    setBirthDate("");
    setProfessionals(null);
    resetBelowProfessional();
  }
  function resetBelowProfessional() {
    setProfessionalId(null);
    clearSearch();
  }
  /** Descarta la agenda mostrada (otro médico, otro estudio…): hay que volver a buscar. */
  function clearSearch() {
    setAvailability(null);
    setDayChosen(null);
    setChoice(null);
    setShowAllDays(false);
    setShowWaitlist(false);
    setSearched(false);
  }

  function chooseKind(next: Kind) {
    if (next === kind) return;
    requestId.current += 1; // ignora respuestas pendientes del camino anterior
    setKind(next);
    setLoading(false);
    setCoverageId(null);
    setStudyId(null);
    resetBelowCoverage();
  }

  async function chooseStudy(id: string) {
    setStudyId(id);
    await searchOccupational();
  }

  async function searchOccupational() {
    const mine = ++requestId.current;
    setLoading(true);
    clearSearch();
    setSearched(true);
    setProfessionalId(ANY); // en la lista de horarios se muestra qué profesional atiende cada uno
    const result = await getOccupationalAvailability();
    if (mine !== requestId.current) return;
    setAvailability(result);
    setLoading(false);
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

  async function chooseSpecialty(id: string) {
    setSpecialtyId(id);
    resetBelowSpecialty();
    const target = specialties?.find((s) => s.id === id);
    // Si la especialidad tiene límite de edad, primero se pide la fecha de nacimiento.
    if (target && (target.minAgeYears !== null || target.maxAgeYears !== null)) return;
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
      birthDate: hasAgeLimit && birthDateValid ? birthDate : null,
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
    if (isOccupational) await searchOccupational();
    else if (professionalId) await search(professionalId, visitType);
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
  const requirements = choice
    ? mergeRequirements(
        availability?.requirementsByProfessional[choice.slot.professionalId] ?? [],
        isOccupational ? studyInstructionLines(study?.instructions) : [],
      )
    : [];
  const showBookingForm = !!choice && !!bookingCoverage && (!isOccupational || !!study);
  const errors = bookingState.fieldErrors ?? {};
  const waitErrors = waitState.fieldErrors ?? {};

  // Numeración de los pasos según el camino elegido.
  let stepNumber = 0;
  const nextStep = () => ++stepNumber;

  return (
    <div className="space-y-5">
      <Step n={nextStep()} title="¿Qué tipo de turno necesitás?">
        <div className="grid gap-2 sm:grid-cols-2">
          <Option selected={kind === "PERSONAL"} onClick={() => chooseKind("PERSONAL")}>
            <span className="block font-medium">Personal</span>
            <span className="block text-xs text-zinc-500">Consulta con un médico, con obra social o particular</span>
          </Option>
          <Option selected={kind === "OCCUPATIONAL"} onClick={() => chooseKind("OCCUPATIONAL")}>
            <span className="block font-medium">Preocupacional</span>
            <span className="block text-xs text-zinc-500">Estudio laboral solicitado por una empresa</span>
          </Option>
        </div>
      </Step>

      {kind === "OCCUPATIONAL" && (
        <Step n={nextStep()} title="¿Qué estudio necesitás?">
          {!occupational ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Por el momento no hay turnos preocupacionales online. Comunicate con el centro para consultar.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {occupational.studies.map((st) => (
                <Option key={st.id} selected={st.id === studyId} onClick={() => chooseStudy(st.id)}>
                  <span className="block font-medium">{st.name}</span>
                  {st.description && <span className="block text-xs text-zinc-500">{st.description}</span>}
                </Option>
              ))}
            </div>
          )}
        </Step>
      )}

      {kind === "PERSONAL" && (
        <Step n={nextStep()} title="¿Con qué cobertura te atendés?">
          <div className="flex flex-wrap gap-2">
            {coverages.map((c) => (
              <Option key={c.id} selected={c.id === coverageId} onClick={() => chooseCoverage(c.id)}>
                {c.name}
              </Option>
            ))}
          </div>
        </Step>
      )}

      {kind === "PERSONAL" && coverage && (
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
            <div className="mt-4 max-w-xs">
              <label htmlFor="birthDateGate" className="mb-1 block text-sm font-medium">
                Fecha de nacimiento del paciente
              </label>
              <input
                id="birthDateGate"
                type="date"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  setBirthDate(e.target.value);
                  setProfessionals(null);
                  resetBelowProfessional();
                }}
                onBlur={() => {
                  if (readyForProfessional && professionals === null && specialtyId) void loadProfessionals(specialtyId);
                }}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-zinc-500">
                {specialty.name} atiende pacientes de {specialty.minAgeYears ?? 0} a {specialty.maxAgeYears ?? "…"} años.
              </p>
              {ageOutOfRange && (
                <p role="alert" className="mt-1 text-sm text-red-600">
                  Esta especialidad no atiende pacientes de {age} años.
                </p>
              )}
              {readyForProfessional && professionals === null && !loading && (
                <button
                  type="button"
                  onClick={() => specialtyId && loadProfessionals(specialtyId)}
                  className="mt-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
                >
                  Continuar
                </button>
              )}
            </div>
          )}
        </Step>
      )}

      {kind === "PERSONAL" && coverage && specialty && readyForProfessional && professionals && (
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
                {isOccupational
                  ? "No hay turnos preocupacionales disponibles por el momento. Comunicate con el centro."
                  : `No hay turnos disponibles con ${coverage?.name} por el momento.`}
              </p>
              {!isOccupational && availability.particularAlternative && (
                <button
                  type="button"
                  onClick={() => switchToParticular(availability.particularAlternative!.coverageId)}
                  className="block w-full rounded-xl border border-teal-600 p-3 text-left text-sm hover:bg-teal-50 dark:hover:bg-teal-950"
                >
                  <strong>Ver turnos de atención particular</strong>
                  <span className="block text-zinc-600 dark:text-zinc-400">Hay turnos disponibles si te atendés de forma particular.</span>
                </button>
              )}
              {!isOccupational && !showWaitlist && !waitState.ok && (
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

      {!isOccupational && showWaitlist && coverage && specialty && (
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
              <PatientFields errors={waitErrors} showAffiliate={!coverage.isParticular} defaultBirthDate={birthDate} values={waitState.values} />
              <Consent error={waitErrors.consent} checked={waitState.values?.consent === "on"} />
              {waitState.error && <p role="alert" className="text-sm text-red-600">{waitState.error}</p>}
              <button type="submit" disabled={joiningWaitlist} className="w-full rounded-lg bg-teal-600 px-4 py-3 font-medium text-white hover:bg-teal-700 disabled:opacity-60">
                {joiningWaitlist ? "Anotando…" : "Anotarme en la lista de espera"}
              </button>
            </form>
          )}
        </Step>
      )}

      {showBookingForm && choice && bookingCoverage && (
        <Step n={nextStep()} title="Tus datos">
          <p className="mb-4 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
            <strong>{longDay(choice.date)}</strong> a las <strong>{choice.slot.time} hs</strong>
            <br />
            {isOccupational
              ? `${choice.slot.professionalName} · Preocupacional: ${study?.name}`
              : `${choice.slot.professionalName} · ${specialty?.name} · ${coverage?.name}`}
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
            <input type="hidden" name="coverageId" value={bookingCoverage.id} />
            <input type="hidden" name="professionalId" value={choice.slot.professionalId} />
            <input type="hidden" name="date" value={choice.date} />
            <input type="hidden" name="startMinutes" value={choice.slot.startMinutes} />
            {isOccupational && study && (
              <>
                <input type="hidden" name="occupational" value="1" />
                <input type="hidden" name="studyId" value={study.id} />
              </>
            )}
            <PatientFields
              errors={errors}
              showAffiliate={!isOccupational && !bookingCoverage.isParticular}
              showCompany={isOccupational}
              defaultBirthDate={birthDate}
              values={bookingState.values}
            />
            <div>
              <label htmlFor="notes" className="mb-1 block text-sm font-medium">
                Comentarios <span className="font-normal text-zinc-500">(opcional)</span>
              </label>
              <textarea id="notes" name="notes" rows={2} maxLength={300} defaultValue={bookingState.values?.notes} className={inputClass} />
              <p className="mt-1 text-xs text-zinc-500">No escribas datos médicos: el equipo los consulta en la atención.</p>
            </div>
            <Consent error={errors.consent} checked={bookingState.values?.consent === "on"} />
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

function PatientFields({
  errors,
  showAffiliate,
  showCompany = false,
  defaultBirthDate,
  values,
}: {
  errors: Record<string, string>;
  showAffiliate: boolean;
  /** Preocupacional: la empresa que solicita el estudio. */
  showCompany?: boolean;
  defaultBirthDate: string;
  /** Lo que la persona ya había escrito: React borra el formulario tras cada envío, así que se repone. */
  values?: Record<string, string>;
}) {
  const field = (id: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input id={id} name={id} required={props.required ?? true} className={inputClass} {...props} defaultValue={values?.[id] ?? props.defaultValue} />
      <FieldError message={errors[id]} />
    </div>
  );

  return (
    <>
      {/* Campo trampa anti-robots: debe quedar vacío. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">No completar</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", "Nombre", { autoComplete: "given-name" })}
        {field("lastName", "Apellido", { autoComplete: "family-name" })}
        {field("dni", "DNI del paciente", { inputMode: "numeric", placeholder: "Sin puntos", autoComplete: "off" })}
        {field("birthDate", "Fecha de nacimiento", { type: "date", defaultValue: defaultBirthDate, max: new Date().toISOString().slice(0, 10), autoComplete: "bday" })}
        {field("email", "Email", { type: "email", autoComplete: "email" })}
        {field("phone", "Teléfono / WhatsApp", { type: "tel", autoComplete: "tel", placeholder: "11 2345 6789" })}
        {showAffiliate && field("affiliateNumber", "Número de afiliado", { required: false, autoComplete: "off" })}
        {showCompany && field("company", "Empresa que solicita el estudio", { autoComplete: "organization", maxLength: 80 })}
      </div>
    </>
  );
}

function Consent({ error, checked }: { error?: string; checked?: boolean }) {
  return (
    <div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" defaultChecked={checked} className="mt-1 h-4 w-4 accent-teal-600" />
        <span>
          Acepto que el centro use mis datos personales para gestionar mi turno y enviarme avisos por mail. Los datos
          se usan solo con ese fin.
        </span>
      </label>
      <FieldError message={error} />
    </div>
  );
}
