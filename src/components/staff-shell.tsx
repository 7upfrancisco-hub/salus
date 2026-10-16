import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ROLES } from "@/lib/constants";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administración",
  SECRETARY: "Secretaría",
  PROFESSIONAL: "Profesional",
};

export function StaffShell({
  user,
  children,
}: {
  user: { name: string; role: string };
  children: ReactNode;
}) {
  const nav = [
    { href: "/agenda", label: "Agenda del día" },
    { href: "/agenda/semana", label: "Semana" },
    { href: "/agenda/lista-espera", label: "Lista de espera" },
    ...(user.role === ROLES.PROFESSIONAL ? [] : [{ href: "/configuracion", label: "Configuración" }]),
  ];

  return (
    <AppShell userName={user.name} subtitle={ROLE_LABEL[user.role] ?? user.role} nav={nav}>
      {children}
    </AppShell>
  );
}
