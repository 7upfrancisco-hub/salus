/** Resultado común de los formularios de configuración. */
export type FormState = {
  ok?: boolean;
  error?: string;
  /** Aviso que no impide guardar (por ejemplo, turnos ya dados que quedan afectados). */
  notice?: string;
};

export const saved = (notice?: string): FormState => ({ ok: true, notice });
export const failed = (error: string): FormState => ({ error });

/** Junta los errores de validación de zod en un solo mensaje legible. */
export function summarize(errors: Record<string, string>) {
  return `Revisá los datos: ${[...new Set(Object.values(errors))].join("; ")}.`;
}
