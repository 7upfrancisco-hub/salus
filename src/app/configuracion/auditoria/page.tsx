import type { Metadata } from "next";
import Link from "next/link";
import { StaffShell } from "@/components/staff-shell";
import { requireAdmin } from "@/lib/config-access";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Registro de actividad" };

const ACTION_LABEL: Record<string, string> = {
  LOGIN: "Ingreso",
  LOGIN_FAILED: "Ingreso fallido",
  APPOINTMENT_CREATED: "Turno dado (secretaría)",
  APPOINTMENT_CREATED_ONLINE: "Turno reservado online",
  APPOINTMENT_CREATED_OVERRIDE: "Turno con override",
  APPOINTMENT_CANCELLED: "Turno cancelado (secretaría)",
  APPOINTMENT_CANCELLED_BY_PATIENT: "Turno cancelado por el paciente",
  APPOINTMENT_STATUS_CHANGED: "Cambio de estado de turno",
  PATIENT_VIEWED: "Consulta de ficha de paciente",
  PATIENT_CONTACT_UPDATED: "Datos de contacto actualizados",
  RULE_CREATED: "Regla creada",
  RULE_UPDATED: "Regla modificada",
  RULE_DELETED: "Regla eliminada",
  AGENDA_UPDATED: "Horarios modificados",
  EXCEPTION_CREATED: "Bloqueo creado",
  EXCEPTION_DELETED: "Bloqueo quitado",
  OVERBOOK_ALLOWANCE_SAVED: "Sobreturnos habilitados",
  USER_CREATED: "Usuario creado",
  USER_UPDATED: "Usuario modificado",
  USER_UPDATED_PASSWORD_RESET: "Contraseña restablecida",
  SETTINGS_UPDATED: "Datos del centro modificados",
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AuditPage({ searchParams }: PageProps<"/configuracion/auditoria">) {
  const user = await requireAdmin();
  const params = await searchParams;
  const action = first(params.accion);

  const [entries, actions] = await Promise.all([
    db.auditLog.findMany({
      where: action ? { action } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: { select: { name: true, role: true } } },
    }),
    db.auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { action: "asc" } }),
  ]);

  return (
    <StaffShell user={user}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Registro de actividad</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Quién hizo qué y cuándo. Este registro solo se agrega: el sistema no permite editarlo ni borrarlo. Se muestran las últimas 200 entradas.
      </p>

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filtrar por acción">
        <Link href="/configuracion/auditoria" className={`rounded-full border px-3 py-1 text-xs ${!action ? "border-teal-600 bg-teal-600 text-white" : "border-zinc-300 dark:border-zinc-700"}`}>
          Todo
        </Link>
        {actions.map((a) => (
          <Link
            key={a.action}
            href={`/configuracion/auditoria?accion=${a.action}`}
            className={`rounded-full border px-3 py-1 text-xs ${action === a.action ? "border-teal-600 bg-teal-600 text-white" : "border-zinc-300 dark:border-zinc-700"}`}
          >
            {ACTION_LABEL[a.action] ?? a.action} ({a._count._all})
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">Cuándo</th>
              <th className="px-3 py-2">Quién</th>
              <th className="px-3 py-2">Qué</th>
              <th className="px-3 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {entries.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2">{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium" }).format(e.createdAt)}</td>
                <td className="px-3 py-2">{e.user?.name ?? <span className="text-zinc-500">Paciente / sistema</span>}</td>
                <td className="px-3 py-2">{ACTION_LABEL[e.action] ?? e.action}</td>
                <td className="max-w-md px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {e.details ? <details><summary className="cursor-pointer">ver</summary><pre className="mt-1 whitespace-pre-wrap break-words">{prettify(e.details)}</pre></details> : "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">Todavía no hay actividad registrada.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </StaffShell>
  );
}

function prettify(details: string) {
  try {
    return JSON.stringify(JSON.parse(details), null, 2).slice(0, 1500);
  } catch {
    return details.slice(0, 1500);
  }
}
