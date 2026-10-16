"use server";

import { revalidatePath } from "next/cache";
import { cancelAppointment, confirmByPatient } from "@/lib/booking";
import { allowRequest } from "@/lib/rate-limit";

export type ManageState = { ok?: boolean; error?: string; done?: "confirmed" | "cancelled" };

export async function confirmAttendance(token: string): Promise<ManageState> {
  if (!(await allowRequest("manage", 20, 10 * 60_000))) return { error: "Demasiados intentos. Probá más tarde." };
  const result = await confirmByPatient(token);
  revalidatePath(`/turno/${token}`);
  return result.ok ? { ok: true, done: "confirmed" } : { error: result.message };
}

export async function cancelByPatient(token: string): Promise<ManageState> {
  if (!(await allowRequest("manage", 20, 10 * 60_000))) return { error: "Demasiados intentos. Probá más tarde." };
  const result = await cancelAppointment({ token, by: "PATIENT" });
  revalidatePath(`/turno/${token}`);
  return result.ok ? { ok: true, done: "cancelled" } : { error: result.message };
}
