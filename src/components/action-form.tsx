"use client";

import { useActionState, useRef, type ReactNode } from "react";
import { primaryButtonClass } from "@/components/ui";
import type { FormState } from "@/lib/form-state";

/**
 * Formulario de configuración: ejecuta una acción del servidor y muestra el resultado
 * ("Guardado" o el error). Los campos se pasan como hijos (pueden venir renderizados desde el servidor).
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Guardar",
  resetOnSuccess = false,
  className = "space-y-4",
  confirmMessage,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel?: string;
  resetOnSuccess?: boolean;
  className?: string;
  /** Si se indica, pide confirmación antes de enviar (para acciones destructivas). */
  confirmMessage?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.ok && resetOnSuccess) formRef.current?.reset();
      return result;
    },
    {} as FormState,
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Guardando…" : submitLabel}
        </button>
        {state.ok && !pending && <span className="text-sm text-green-700">Guardado ✓</span>}
        {state.notice && !pending && (
          <span role="status" className="rounded-md bg-amber-100 px-2 py-1 text-sm text-amber-900">
            {state.notice}
          </span>
        )}
        {state.error && (
          <span role="alert" className="text-sm text-red-600">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
