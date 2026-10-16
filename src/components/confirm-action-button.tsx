"use client";

/** Botón que ejecuta una acción del servidor pidiendo confirmación antes (para eliminar o desactivar). */
export function ConfirmActionButton({
  action,
  label,
  confirmMessage,
  className = "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-zinc-700",
}: {
  action: () => Promise<void>;
  label: string;
  confirmMessage: string;
  className?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
