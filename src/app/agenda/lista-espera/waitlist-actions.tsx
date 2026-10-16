"use client";

import { useState, useTransition } from "react";
import { renotifyWaitlist, setWaitlistStatus, type ActionState } from "../actions";

const btn =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function WaitlistActions({ entryId, canNotify }: { entryId: string; canNotify: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(task: () => Promise<ActionState>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {canNotify && (
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => renotifyWaitlist(entryId))}>
            Avisar por mail
          </button>
        )}
        <button type="button" className={btn} disabled={pending} onClick={() => run(() => setWaitlistStatus(entryId, "BOOKED"))}>
          Ya tiene turno
        </button>
        <button type="button" className={`${btn} text-red-700`} disabled={pending} onClick={() => run(() => setWaitlistStatus(entryId, "CANCELLED"))}>
          Quitar de la lista
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
