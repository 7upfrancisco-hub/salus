import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readSessionUserId } from "@/lib/session";
import type { Role } from "@/lib/constants";

/** Usuario logueado (o null). Se consulta una sola vez por request. */
export const getCurrentUser = cache(async () => {
  const userId = await readSessionUserId();
  if (!userId) return null;

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return null;
  return user;
});

/** Exige estar logueado con alguno de los roles indicados; si no, redirige. */
export async function requireRole(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role as Role)) redirect(homeFor());
  return user;
}

/** Cualquier usuario del personal (admin, secretaría o profesional). */
export async function requireStaff() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function homeFor() {
  return "/agenda";
}
