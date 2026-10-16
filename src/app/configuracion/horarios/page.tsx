import type { Metadata } from "next";
import Link from "next/link";
import { StaffShell } from "@/components/staff-shell";
import { getManageableProfessionals } from "@/lib/access";
import { requireConfigUser } from "@/lib/config-access";
import { db } from "@/lib/db";
import { AgendaEditor } from "./agenda-editor";

export const metadata: Metadata = { title: "Horarios de atención" };

export default async function SchedulePage({ searchParams }: PageProps<"/configuracion/horarios">) {
  const user = await requireConfigUser();
  const params = await searchParams;
  const professionals = await getManageableProfessionals(user);
  const requested = Array.isArray(params.profesional) ? params.profesional[0] : params.profesional;
  const professional = professionals.find((p) => p.id === requested) ?? professionals[0];

  const [offices, blocks] = professional
    ? await Promise.all([
        db.office.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        db.agendaBlock.findMany({ where: { professionalId: professional.id, active: true }, orderBy: [{ weekday: "asc" }, { startMinutes: "asc" }] }),
      ])
    : [[], []];

  return (
    <StaffShell user={user}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Horarios de atención</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Cuándo atiende cada profesional. Los turnos se generan a partir de estos bloques; las reglas por cobertura
        deciden luego a quién se le da cada franja.
      </p>

      {!professional ? (
        <p className="text-sm text-zinc-500">No tenés agendas asignadas.</p>
      ) : (
        <>
          {professionals.length > 1 && (
            <nav className="mb-6 flex flex-wrap gap-2" aria-label="Elegir profesional">
              {professionals.map((p) => (
                <Link
                  key={p.id}
                  href={`/configuracion/horarios?profesional=${p.id}`}
                  className={`rounded-full border px-3 py-1 text-sm ${p.id === professional.id ? "border-teal-600 bg-teal-600 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}
                >
                  {p.name}
                </Link>
              ))}
            </nav>
          )}
          <h2 className="mb-3 text-lg font-semibold">{professional.name} · {professional.specialty.name}</h2>
          <div className="max-w-3xl">
            <AgendaEditor
              key={professional.id}
              professionalId={professional.id}
              offices={offices}
              initialBlocks={blocks.map((b) => ({
                weekday: b.weekday,
                startMinutes: b.startMinutes,
                endMinutes: b.endMinutes,
                slotMinutes: b.slotMinutes,
                officeId: b.officeId,
                validFrom: b.validFrom,
                validTo: b.validTo,
              }))}
            />
          </div>
        </>
      )}
    </StaffShell>
  );
}
