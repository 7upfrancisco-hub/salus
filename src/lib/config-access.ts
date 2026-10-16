import "server-only";
import { redirect } from "next/navigation";
import { requireRole, requireStaff } from "@/lib/auth";
import { ROLES } from "@/lib/constants";

/** Personal que puede tocar la configuración de agendas: administración y secretaría. */
export async function requireConfigUser() {
  const user = await requireStaff();
  if (user.role === ROLES.PROFESSIONAL) redirect("/agenda");
  return user;
}

/** Solo administración: catálogos, profesionales, usuarios, datos del centro y auditoría. */
export async function requireAdmin() {
  return requireRole(ROLES.ADMIN);
}

/**
 * ¿Puede tocar cosas que afectan a todo el centro (feriados, reglas de toda una especialidad,
 * cupos compartidos)? Solo administración y quien tenga "gestiona todo".
 */
export const isGlobalEditor = (user: { role: string; manageAll: boolean }) =>
  user.role === ROLES.ADMIN || user.manageAll;
