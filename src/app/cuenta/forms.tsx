"use client";

import { useActionState, useEffect, useRef, type InputHTMLAttributes } from "react";
import { inputClass } from "@/components/ui";
import {
  addFamilyMember,
  changePassword,
  loginAccount,
  registerAccount,
  type AccountFormState,
} from "./actions";

const initial: AccountFormState = {};
const buttonClass = "w-full rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-white transition hover:bg-teal-700 disabled:opacity-60";
const today = () => new Date().toISOString().slice(0, 10);

function Input({
  id,
  label,
  state,
  hint,
  ...props
}: { id: string; label: string; state: AccountFormState; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const error = state.fieldErrors?.[id];
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input id={id} name={id} required defaultValue={state.values?.[id]} aria-invalid={error ? true : undefined} className={inputClass} {...props} />
      {hint && !error && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Campo trampa anti-robots: las personas no lo ven, debe quedar vacío. */
function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label htmlFor="website">No completar</label>
      <input id="website" name="website" tabIndex={-1} autoComplete="off" />
    </div>
  );
}

function FormError({ state }: { state: AccountFormState }) {
  // Si el error ya se muestra debajo de su campo no se repite arriba.
  const shownInField = state.fieldErrors && Object.values(state.fieldErrors).includes(state.error ?? "");
  return state.error && !shownInField ? (
    <p role="alert" className="text-sm text-red-600">
      {state.error}
    </p>
  ) : null;
}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAccount, initial);
  return (
    <form action={action} className="space-y-4">
      <Input id="dni" label="DNI" state={state} inputMode="numeric" autoComplete="username" placeholder="Sin puntos" />
      <Input id="password" label="Contraseña" state={state} type="password" autoComplete="current-password" />
      <FormError state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAccount, initial);
  return (
    <form action={action} className="space-y-4">
      <Honeypot />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input id="firstName" label="Nombre" state={state} autoComplete="given-name" />
        <Input id="lastName" label="Apellido" state={state} autoComplete="family-name" />
        <Input id="dni" label="DNI" state={state} inputMode="numeric" placeholder="Sin puntos" autoComplete="off" hint="Con este número vas a ingresar." />
        <Input id="birthDate" label="Fecha de nacimiento" state={state} type="date" max={today()} autoComplete="bday" />
        <Input id="email" label="Email" state={state} type="email" autoComplete="email" />
        <Input id="phone" label="Teléfono / WhatsApp" state={state} type="tel" autoComplete="tel" placeholder="11 2345 6789" />
        <Input id="password" label="Contraseña" state={state} type="password" autoComplete="new-password" minLength={8} maxLength={64} hint="Mínimo 8 caracteres." />
        <Input id="passwordConfirm" label="Repetí la contraseña" state={state} type="password" autoComplete="new-password" minLength={8} maxLength={64} />
      </div>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" defaultChecked={state.values?.consent === "on"} className="mt-1 h-4 w-4 accent-teal-600" />
          <span>
            Acepto que el centro use mis datos personales para gestionar mis turnos y enviarme avisos por mail. Los datos
            se usan solo con ese fin.
          </span>
        </label>
        {state.fieldErrors?.consent && <p className="mt-1 text-xs text-red-600">{state.fieldErrors.consent}</p>}
      </div>
      <FormError state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Creando cuenta…" : "Crear cuenta"}
      </button>
    </form>
  );
}

export function FamilyForm() {
  const [state, action, pending] = useActionState(addFamilyMember, initial);
  const formRef = useRef<HTMLFormElement>(null);
  // React vacía el formulario tras cada envío; solo se repone con lo escrito si hubo un error.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input id="firstName" label="Nombre" state={state} />
        <Input id="lastName" label="Apellido" state={state} />
        <Input id="dni" label="DNI" state={state} inputMode="numeric" placeholder="Sin puntos" autoComplete="off" />
        <Input id="birthDate" label="Fecha de nacimiento" state={state} type="date" max={today()} />
        <div>
          <label htmlFor="relation" className="mb-1 block text-sm font-medium">
            Parentesco
          </label>
          <select id="relation" name="relation" defaultValue={state.values?.relation ?? "CHILD"} className={inputClass}>
            <option value="CHILD">Hijo/a</option>
            <option value="OTHER">Otra persona a cargo</option>
          </select>
        </div>
      </div>
      <FormError state={state} />
      {state.ok && <p role="status" className="text-sm text-green-700">Listo, ya podés sacarle turnos ✓</p>}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Agregando…" : "Agregar persona"}
      </button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <Input id="current" label="Contraseña actual" state={state} type="password" autoComplete="current-password" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input id="password" label="Contraseña nueva" state={state} type="password" autoComplete="new-password" minLength={8} maxLength={64} />
        <Input id="passwordConfirm" label="Repetí la nueva" state={state} type="password" autoComplete="new-password" minLength={8} maxLength={64} />
      </div>
      <FormError state={state} />
      {state.ok && <p role="status" className="text-sm text-green-700">Contraseña actualizada ✓</p>}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Guardando…" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
