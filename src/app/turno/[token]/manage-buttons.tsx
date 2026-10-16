"use client";

import { useActionState } from "react";
import { cancelByPatient, confirmAttendance, type ManageState } from "./actions";

const initial: ManageState = {};

export function ManageButtons({
  token,
  canConfirm,
  canCancel,
  cancelHint,
}: {
  token: string;
  canConfirm: boolean;
  canCancel: boolean;
  /** Si no se puede cancelar online, por qué. */
  cancelHint: string | null;
}) {
  const [confirmState, confirmAction, confirming] = useActionState(() => confirmAttendance(token), initial);
  const [cancelState, cancelAction, cancelling] = useActionState(() => cancelByPatient(token), initial);

  return (
    <div className="space-y-3">
      {canConfirm && (
        <form action={confirmAction}>
          <button
            type="submit"
            disabled={confirming}
            className="w-full rounded-lg bg-teal-600 px-4 py-3 font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {confirming ? "Confirmando…" : "Confirmo que voy a asistir"}
          </button>
          {confirmState.error && <p role="alert" className="mt-1 text-sm text-red-600">{confirmState.error}</p>}
        </form>
      )}

      {canCancel && (
        <form
          action={cancelAction}
          onSubmit={(e) => {
            if (!window.confirm("¿Seguro que querés cancelar este turno?")) e.preventDefault();
          }}
        >
          <button
            type="submit"
            disabled={cancelling}
            className="w-full rounded-lg border border-red-300 px-4 py-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {cancelling ? "Cancelando…" : "Cancelar turno"}
          </button>
          {cancelState.error && <p role="alert" className="mt-1 text-sm text-red-600">{cancelState.error}</p>}
        </form>
      )}

      {!canCancel && cancelHint && <p className="text-center text-xs text-zinc-500">{cancelHint}</p>}
    </div>
  );
}
