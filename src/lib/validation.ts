import { z } from "zod";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { todayInZone } from "@/lib/time";

/** DNI: solo números, entre 6 y 9 dígitos (se aceptan puntos y espacios al tipearlo). */
export const dniSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[.\s]/g, ""))
  .pipe(z.string().regex(/^\d{6,9}$/, "Ingresá un DNI válido (solo números)"));

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Ingresá un email válido"));

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s()-]{6,24}$/, "Ingresá un teléfono válido")
  .refine((v) => v.replace(/\D/g, "").length >= 8, "Ingresá un teléfono válido");

export const birthDateSchema = z
  .iso.date("Ingresá la fecha de nacimiento")
  // "Hoy" es el de la zona del centro: con la fecha UTC, de noche aceptaría un mañana o rechazaría un hoy.
  .refine((d) => d >= "1900-01-01" && d <= todayInZone(DEFAULT_TIMEZONE), "Fecha de nacimiento inválida");

const nameSchema = (label: string) =>
  z.string().trim().min(2, `Ingresá ${label}`).max(60, `${label} es demasiado largo`);

export const patientSchema = z.object({
  dni: dniSchema,
  firstName: nameSchema("el nombre"),
  lastName: nameSchema("el apellido"),
  birthDate: birthDateSchema,
  email: emailSchema,
  phone: phoneSchema,
  /** Opcional; un texto vacío se trata como "sin dato". */
  affiliateNumber: z.string().trim().max(40).optional(),
});
export type PatientInput = z.infer<typeof patientSchema>;

/** Convierte los errores de zod en un mapa campo → mensaje (el primer error de cada campo). */
export function fieldErrors(error: z.ZodError) {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}

/** Texto libre opcional → string o null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
