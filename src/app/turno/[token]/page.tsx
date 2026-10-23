import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cardClass } from "@/components/ui";
import { APPOINTMENT_STATUS } from "@/lib/constants";
import { db } from "@/lib/db";
import { formatWhen } from "@/lib/email-templates";
import { getRequirements } from "@/lib/requirements";
import { mergeRequirements, studyInstructionLines } from "@/lib/studies";
import { APPOINTMENT_STATUS_LABEL } from "@/lib/status-labels";
import { ManageButtons } from "./manage-buttons";

export const metadata: Metadata = {
  title: "Mi turno",
  robots: { index: false, follow: false },
};

const BADGE: Record<string, string> = {
  RESERVED: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-green-100 text-green-800",
  CANCELLED: "bg-zinc-200 text-zinc-700",
  ATTENDED: "bg-zinc-200 text-zinc-700",
  NO_SHOW: "bg-zinc-200 text-zinc-700",
};

export default async function MyAppointmentPage({ params }: PageProps<"/turno/[token]">) {
  const { token } = await params;

  const appointment = await db.appointment.findUnique({
    where: { manageToken: token },
    include: { patient: true, professional: { include: { specialty: true } }, coverage: true, study: true, office: true },
  });
  if (!appointment) notFound();

  const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
  const timezone = settings?.timezone ?? "America/Argentina/Buenos_Aires";
  const limitHours = settings?.cancelLimitHours ?? 12;

  const active =
    appointment.status === APPOINTMENT_STATUS.RESERVED || appointment.status === APPOINTMENT_STATUS.CONFIRMED;
  const now = new Date();
  const upcoming = appointment.startsAt > now;
  const withinCancelLimit = appointment.startsAt.getTime() - now.getTime() >= limitHours * 3_600_000;

  const requirements =
    active && upcoming
      ? mergeRequirements(
          await getRequirements(appointment.professionalId, appointment.coverageId),
          studyInstructionLines(appointment.study?.instructions),
        )
      : [];

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <p className="mb-1 text-center text-2xl font-bold tracking-tight">
        Sal<span className="text-teal-600">us</span>
      </p>
      <p className="mb-6 text-center">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${BADGE[appointment.status] ?? BADGE.CANCELLED}`}>
          {APPOINTMENT_STATUS_LABEL[appointment.status] ?? appointment.status}
        </span>
      </p>

      <div className={`${cardClass} space-y-3`}>
        <p className="text-lg font-semibold">{formatWhen(appointment.startsAt, timezone)} hs</p>
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2"><dt className="w-28 text-zinc-500">Profesional</dt><dd>{appointment.professional.name}</dd></div>
          <div className="flex gap-2"><dt className="w-28 text-zinc-500">Especialidad</dt><dd>{appointment.professional.specialty.name}</dd></div>
          {appointment.coverage.isOccupational ? (
            <>
              <div className="flex gap-2"><dt className="w-28 text-zinc-500">Turno</dt><dd>Preocupacional</dd></div>
              {appointment.study && <div className="flex gap-2"><dt className="w-28 text-zinc-500">Estudio</dt><dd>{appointment.study.name}</dd></div>}
              {appointment.company && <div className="flex gap-2"><dt className="w-28 text-zinc-500">Empresa</dt><dd>{appointment.company}</dd></div>}
            </>
          ) : (
            <div className="flex gap-2"><dt className="w-28 text-zinc-500">Cobertura</dt><dd>{appointment.coverage.name}</dd></div>
          )}
          {appointment.office && <div className="flex gap-2"><dt className="w-28 text-zinc-500">Consultorio</dt><dd>{appointment.office.name}</dd></div>}
          <div className="flex gap-2"><dt className="w-28 text-zinc-500">Paciente</dt><dd>{appointment.patient.firstName} {appointment.patient.lastName}</dd></div>
        </dl>
      </div>

      {requirements.length > 0 && (
        <div className="mt-4 rounded-xl border border-teal-600 bg-teal-50 p-4 text-sm dark:bg-teal-950">
          <p className="mb-1 font-semibold">Acordate de traer:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {appointment.status === APPOINTMENT_STATUS.CANCELLED && (
        <p className="mt-4 text-center text-sm text-zinc-500">Este turno fue cancelado.</p>
      )}

      {active && upcoming && (
        <div className="mt-6">
          <ManageButtons
            token={token}
            canConfirm={appointment.status === APPOINTMENT_STATUS.RESERVED}
            canCancel={withinCancelLimit}
            cancelHint={
              withinCancelLimit
                ? null
                : `Ya no se puede cancelar online (se cancela hasta ${limitHours} horas antes). Si no podés asistir, comunicate con el centro.`
            }
          />
        </div>
      )}

      <p className="mt-8 text-center text-sm">
        <Link href="/" className="text-teal-700 hover:underline">
          Sacar otro turno
        </Link>
      </p>
    </main>
  );
}
