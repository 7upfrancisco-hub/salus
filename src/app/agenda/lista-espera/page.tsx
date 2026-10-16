import type { Metadata } from "next";
import { StaffShell } from "@/components/staff-shell";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { manageableSpecialtyIds } from "../actions";
import { WaitlistActions } from "./waitlist-actions";

export const metadata: Metadata = { title: "Lista de espera" };

const STATUS_LABEL: Record<string, string> = {
  WAITING: "Esperando",
  NOTIFIED: "Avisado",
};

export default async function WaitlistPage() {
  const user = await requireStaff();
  const specialtyIds = await manageableSpecialtyIds(user);

  const entries = await db.waitlistEntry.findMany({
    where: { status: { in: ["WAITING", "NOTIFIED"] }, specialtyId: { in: specialtyIds } },
    orderBy: { createdAt: "asc" },
    include: { patient: true, coverage: true, specialty: true, professional: true },
  });

  return (
    <StaffShell user={user}>
      <h1 className="text-2xl font-bold tracking-tight">Lista de espera</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Pacientes que no encontraron turno. Cuando se cancela un turno que les sirve, se les avisa por mail
        automáticamente (a los primeros de la lista). Acá podés reavisar o cerrar cada pedido.
      </p>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No hay nadie en lista de espera.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {e.patient.lastName}, {e.patient.firstName}{" "}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${e.status === "NOTIFIED" ? "bg-sky-100 text-sky-900" : "bg-amber-100 text-amber-900"}`}>
                      {STATUS_LABEL[e.status]}
                    </span>
                  </p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {e.specialty.name} · {e.coverage.name} · {e.professional ? e.professional.name : "cualquier profesional"}
                  </p>
                  <p className="text-sm text-zinc-500">
                    DNI {e.patient.dni} · {e.patient.phone}
                    {e.patient.email ? ` · ${e.patient.email}` : ""}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Anotado el {new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(e.createdAt)}
                    {e.notifiedAt ? ` · avisado el ${new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(e.notifiedAt)}` : ""}
                  </p>
                </div>
                <WaitlistActions entryId={e.id} canNotify={!!e.patient.email} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </StaffShell>
  );
}
