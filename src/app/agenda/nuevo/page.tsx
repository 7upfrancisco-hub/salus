import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffShell } from "@/components/staff-shell";
import { canManageProfessional } from "@/lib/access";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { verificarTurno } from "@/lib/engine/engine";
import { loadEngineContext } from "@/lib/engine/load";
import { OVERRIDABLE_STATUSES, SLOT_STATUS_LABEL } from "@/lib/status-labels";
import { capitalizeFirst, minutesToTime } from "@/lib/time";
import { StaffBookingForm, type CoverageOption } from "./staff-booking-form";

export const metadata: Metadata = { title: "Dar turno" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function NewStaffAppointmentPage({ searchParams }: PageProps<"/agenda/nuevo">) {
  const user = await requireStaff();
  const params = await searchParams;

  const professionalId = first(params.profesional) ?? "";
  const date = first(params.fecha) ?? "";
  const startMinutes = Number(first(params.hora));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(startMinutes)) redirect("/agenda");
  if (!(await canManageProfessional(user, professionalId))) redirect("/agenda");

  const [context, professional, coverages] = await Promise.all([
    loadEngineContext({ professionalId, from: date, to: date }),
    db.professional.findUniqueOrThrow({ where: { id: professionalId }, include: { specialty: true } }),
    db.coverage.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);

  const options: CoverageOption[] = [];
  let slotExists = false;
  if (context) {
    for (const coverage of coverages) {
      const slot = verificarTurno(context.inputFor({ coverageId: coverage.id, visitType: "CONTROL", audience: "staff" }), date, startMinutes);
      if (slot) slotExists = true;
      options.push({
        id: coverage.id,
        name: coverage.name,
        color: coverage.color,
        isParticular: coverage.isParticular,
        problems: (slot?.violations ?? []).map((v) => ({
          label: SLOT_STATUS_LABEL[v],
          overridable: OVERRIDABLE_STATUSES.includes(v),
        })),
      });
    }
  }

  const preselected = first(params.cobertura);
  const dateText = capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`)),
  );

  return (
    <StaffShell user={user}>
      <Link href={`/agenda?profesional=${professionalId}&fecha=${date}`} className="text-sm text-zinc-500 hover:text-foreground">
        ← Volver a la agenda
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Dar turno</h1>
      <p className="mb-6 text-sm text-zinc-500">
        {professional.name} · {professional.specialty.name} · {dateText}, {minutesToTime(startMinutes)} hs
      </p>

      {!slotExists ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Ese horario no existe en la agenda del profesional. Volvé a la agenda y elegí otro.
        </p>
      ) : (
        <StaffBookingForm
          professionalId={professionalId}
          date={date}
          startMinutes={startMinutes}
          coverages={options}
          preselectedCoverageId={options.some((o) => o.id === preselected) ? preselected : undefined}
        />
      )}
    </StaffShell>
  );
}
