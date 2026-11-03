import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { StaffShell } from "@/components/staff-shell";
import { inputBase, primaryButtonClass } from "@/components/ui";
import { requireConfigUser } from "@/lib/config-access";
import { db } from "@/lib/db";
import { setBlocked, setVerified } from "./actions";

export const metadata: Metadata = { title: "Cuentas de pacientes" };

const LIMIT = 60;
const dateLabel = (d: Date) => new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(d);

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string }> }) {
  const user = await requireConfigUser();
  const { q = "", estado = "" } = await searchParams;
  const term = q.trim().slice(0, 60);

  const accounts = await db.patientAccount.findMany({
    where: {
      ...(estado === "sin-verificar" ? { verifiedAt: null, blocked: false } : {}),
      ...(term
        ? {
            OR: [
              { dni: { contains: term.replace(/[.\s]/g, "") } },
              { patient: { lastName: { contains: term, mode: "insensitive" } } },
              { patient: { firstName: { contains: term, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    include: { patient: true, verifiedBy: { select: { name: true } }, _count: { select: { dependents: true } } },
  });
  const pending = await db.patientAccount.count({ where: { verifiedAt: null, blocked: false } });

  return (
    <StaffShell user={user}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Cuentas de pacientes</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Los pacientes se registran solos en el turnero y después ingresan solo con su DNI. Como el DNI no es secreto, cuando vienen
        al centro mirá su documento y marcá la cuenta como verificada: pasa de poder tener 2 turnos pendientes a 10. Podés
        bloquear una cuenta sospechosa (por ejemplo, si alguien saca turnos con el DNI de otra persona).
      </p>

      <form className="mb-4 flex flex-wrap items-end gap-3" action="/configuracion/cuentas">
        <div>
          <label htmlFor="q" className="mb-1 block text-sm font-medium">Buscar por DNI o apellido</label>
          <input id="q" name="q" defaultValue={term} className={`${inputBase} w-60`} />
        </div>
        <select name="estado" defaultValue={estado} aria-label="Estado" className={`${inputBase} w-44`}>
          <option value="">Todas</option>
          <option value="sin-verificar">Sin verificar</option>
        </select>
        <button type="submit" className={primaryButtonClass}>Buscar</button>
      </form>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        {pending > 0 ? `${pending} cuenta${pending === 1 ? "" : "s"} sin verificar.` : "No hay cuentas sin verificar."}
        {accounts.length === LIMIT && ` Se muestran las ${LIMIT} más recientes: afiná la búsqueda para ver otras.`}
      </p>

      {accounts.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">No hay cuentas que coincidan.</p>
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => (
            <li key={a.id} className={`rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900 ${a.blocked ? "opacity-70" : ""}`}>
              <p className="text-sm">
                <strong>{a.patient.lastName}, {a.patient.firstName}</strong> · DNI {a.dni} · nació el {a.patient.birthDate.split("-").reverse().join("/")}
              </p>
              <p className="mb-3 mt-1 text-xs text-zinc-500">
                {a.patient.phone} · {a.patient.email ?? "sin email"} · registrada el {dateLabel(a.createdAt)}
                {a.lastLoginAt && ` · último ingreso ${dateLabel(a.lastLoginAt)}`}
                {a._count.dependents > 0 && ` · ${a._count.dependents} persona${a._count.dependents === 1 ? "" : "s"} a cargo`}
              </p>
              <p className="mb-3 flex flex-wrap gap-2 text-xs font-medium">
                {a.verifiedAt ? (
                  <span className="rounded-full bg-green-100 px-2.5 py-1 text-green-800">
                    Verificada el {dateLabel(a.verifiedAt)}{a.verifiedBy ? ` por ${a.verifiedBy.name}` : ""}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">Sin verificar</span>
                )}
                {a.blocked && <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-800">Bloqueada</span>}
              </p>
              <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                <ActionForm action={setVerified} submitLabel={a.verifiedAt ? "Quitar verificación" : "Verificar (vi el DNI)"} className="space-y-2">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="verified" value={a.verifiedAt ? "0" : "1"} />
                </ActionForm>
                <ActionForm
                  action={setBlocked}
                  submitLabel={a.blocked ? "Desbloquear" : "Bloquear"}
                  confirmMessage={a.blocked ? undefined : "¿Bloquear esta cuenta? El paciente no podrá ingresar al turnero."}
                  className="space-y-2"
                >
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="blocked" value={a.blocked ? "0" : "1"} />
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      )}
    </StaffShell>
  );
}
