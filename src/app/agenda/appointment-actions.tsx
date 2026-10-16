"use client";

import { useState, useTransition } from "react";
import { inputClass } from "@/components/ui";
import { cancelWithReason, changeStatus } from "./actions";

const btn =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function AppointmentActions({
  appointmentId,
  status,
  started,
}: {
  appointmentId: string;
  status: string;
  /** true si la hora del turno ya llegó (recién ahí se puede marcar atendido o ausente). */
  started: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  function run(task: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.error) setError(result.error);
      else setCancelling(false);
    });
  }

  const active = status === "RESERVED" || status === "CONFIRMED";

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "RESERVED" && (
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => changeStatus(appointmentId, "CONFIRMED"))}>
            Confirmar
          </button>
        )}
        {active && (
          <>
            <button
              type="button"
              className={btn}
              disabled={pending || !started}
              title={started ? "" : "Todavía no llegó la hora del turno"}
              onClick={() => run(() => changeStatus(appointmentId, "ATTENDED"))}
            >
              Atendido
            </button>
            <button
              type="button"
              className={btn}
              disabled={pending || !started}
              title={started ? "" : "Todavía no llegó la hora del turno"}
              onClick={() => run(() => changeStatus(appointmentId, "NO_SHOW"))}
            >
              Ausente
            </button>
            <button type="button" className={`${btn} text-red-700`} disabled={pending} onClick={() => setCancelling((v) => !v)}>
              Cancelar turno…
            </button>
          </>
        )}
        {(status === "ATTENDED" || status === "NO_SHOW") && (
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => changeStatus(appointmentId, "CONFIRMED"))}>
            Corregir: volver a confirmado
          </button>
        )}
      </div>

      {cancelling && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <label htmlFor={`reason-${appointmentId}`} className="mb-1 block text-xs font-medium">
            Motivo de la cancelación (queda registrado)
          </label>
          <input
            id={`reason-${appointmentId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
            placeholder="Ej.: el paciente avisó por teléfono"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              disabled={pending || reason.trim().length < 3}
              onClick={() => run(() => cancelWithReason(appointmentId, reason))}
            >
              Cancelar el turno
            </button>
            <button type="button" className={btn} onClick={() => setCancelling(false)}>
              Volver
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
