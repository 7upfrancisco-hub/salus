"use client";

import { deleteRule } from "./actions";

export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  return (
    <form
      action={deleteRule.bind(null, ruleId)}
      onSubmit={(e) => {
        if (!window.confirm("¿Eliminar esta regla? El profesional dejará de atender esta cobertura. Los turnos ya dados no se tocan.")) e.preventDefault();
      }}
    >
      <button type="submit" className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
        Eliminar regla
      </button>
    </form>
  );
}
