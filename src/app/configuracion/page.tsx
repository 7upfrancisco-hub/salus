import type { Metadata } from "next";
import Link from "next/link";
import { StaffShell } from "@/components/staff-shell";
import { requireConfigUser } from "@/lib/config-access";
import { ROLES } from "@/lib/constants";

export const metadata: Metadata = { title: "Configuración" };

const AGENDA_ITEMS = [
  { href: "/configuracion/horarios", title: "Horarios de atención", text: "Días y horas en que atiende cada profesional, consultorio y duración de los turnos." },
  { href: "/configuracion/reglas", title: "Reglas por cobertura", text: "Qué coberturas atiende cada profesional: franjas horarias, cupos y requisitos para el paciente." },
  { href: "/configuracion/excepciones", title: "Feriados, licencias y bloqueos", text: "Días sin atención y sobreturnos habilitados." },
];

const ADMIN_ITEMS = [
  { href: "/configuracion/profesionales", title: "Profesionales", text: "Alta y baja de profesionales y su especialidad." },
  { href: "/configuracion/catalogos", title: "Coberturas, especialidades y consultorios", text: "Obras sociales y prepagas, rangos de edad por especialidad y consultorios." },
  { href: "/configuracion/usuarios", title: "Usuarios", text: "Personal de secretaría y profesionales con acceso al sistema, y qué agendas gestiona cada una." },
  { href: "/configuracion/centro", title: "Datos del centro", text: "Nombre, anticipación mínima, plazo de reserva, cancelaciones y recordatorios." },
  { href: "/configuracion/auditoria", title: "Registro de actividad", text: "Quién hizo qué: turnos, cancelaciones, overrides y cambios de reglas." },
];

export default async function ConfigHomePage() {
  const user = await requireConfigUser();

  return (
    <StaffShell user={user}>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Configuración</h1>
      <p className="mb-6 text-sm text-zinc-500">Todo se edita desde acá: no hace falta tocar código.</p>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Agenda</h2>
      <Grid items={AGENDA_ITEMS} />

      {user.role === ROLES.ADMIN && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wide text-zinc-500">Administración</h2>
          <Grid items={ADMIN_ITEMS} />
        </>
      )}
    </StaffShell>
  );
}

function Grid({ items }: { items: { href: string; title: string; text: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.href}>
          <Link href={item.href} className="block h-full rounded-2xl border border-zinc-200 p-4 transition hover:border-teal-600 hover:bg-teal-50/40 dark:border-zinc-800 dark:hover:bg-teal-950/30">
            <span className="block font-semibold">{item.title}</span>
            <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">{item.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
