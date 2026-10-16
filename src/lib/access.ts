import "server-only";
import { db } from "@/lib/db";
import { ROLES, type Role } from "@/lib/constants";

type AccessUser = { id: string; role: string; manageAll: boolean };

/**
 * Profesionales cuya agenda puede ver y gestionar un usuario:
 *  - ADMIN y quien tenga "manageAll": todos.
 *  - SECRETARY: los que tenga asignados.
 *  - PROFESSIONAL: solo el suyo.
 *
 * Toda pantalla o acción que toque una agenda debe pasar por acá, nunca confiar en un id que
 * venga del navegador.
 */
export async function getManageableProfessionals(user: AccessUser) {
  const base = { active: true } as const;

  if (user.role === ROLES.ADMIN || user.manageAll) {
    return db.professional.findMany({
      where: base,
      orderBy: [{ specialty: { name: "asc" } }, { name: "asc" }],
      include: { specialty: true },
    });
  }

  if (user.role === ROLES.SECRETARY) {
    return db.professional.findMany({
      where: { ...base, access: { some: { userId: user.id } } },
      orderBy: [{ specialty: { name: "asc" } }, { name: "asc" }],
      include: { specialty: true },
    });
  }

  return db.professional.findMany({
    where: { ...base, userId: user.id },
    include: { specialty: true },
  });
}

export async function canManageProfessional(user: AccessUser, professionalId: string) {
  const list = await getManageableProfessionals(user);
  return list.some((p) => p.id === professionalId);
}

/** Solo el administrador configura reglas, coberturas, especialidades y usuarios. */
export function canConfigure(user: { role: string }) {
  return (user.role as Role) === ROLES.ADMIN;
}
