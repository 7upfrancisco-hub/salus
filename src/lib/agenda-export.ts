import "server-only";
import { APPOINTMENT_STATUS } from "@/lib/constants";
import { db } from "@/lib/db";
import type { PdfAgenda } from "@/lib/agenda-pdf";
import { APPOINTMENT_STATUS_LABEL, VISIT_TYPE_LABEL } from "@/lib/status-labels";
import { capitalizeFirst, minutesToTime, utcToZoned } from "@/lib/time";

/** Datos de las agendas del día que se descargan en PDF (la agenda de un médico y la de preocupacionales). */

const dateLabel = (date: string) =>
  capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
      new Date(`${date}T00:00:00Z`),
    ),
  );

const plural = (n: number) => `${n} ${n === 1 ? "turno" : "turnos"}`;

async function settings() {
  const row = await db.centerSettings.findUnique({ where: { id: 1 } });
  return { centerName: row?.name ?? "Salus", timezone: row?.timezone ?? "America/Argentina/Buenos_Aires" };
}

function footer(centerName: string, generatedBy: string, timezone: string) {
  const when = new Intl.DateTimeFormat("es-AR", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date());
  return `${centerName} · Generado el ${when} por ${generatedBy} · Contiene datos personales de salud: uso interno del centro.`;
}

/** Turnos del día que se van a atender (los cancelados no figuran), en orden de horario. */
async function dayAppointments(date: string, where: { professionalId?: string | { in: string[] }; coverage?: { isOccupational: boolean } }) {
  return db.appointment.findMany({
    where: { localDate: date, status: { not: APPOINTMENT_STATUS.CANCELLED }, ...where },
    include: { patient: true, coverage: true, study: true, professional: true },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
}

type Row = Awaited<ReturnType<typeof dayAppointments>>[number];

const timeOf = (a: Row, timezone: string) =>
  `${minutesToTime(utcToZoned(a.startsAt, timezone).minutes)}-${minutesToTime(utcToZoned(a.endsAt, timezone).minutes)}`;

const observations = (a: Row) =>
  [a.notes, a.isOverride && a.overrideReason ? `Sobreturno: ${a.overrideReason}` : null].filter(Boolean).join(" · ");

/** Agenda del día de un profesional, con todas sus coberturas (los preocupacionales llevan estudio y empresa). */
export async function doctorDayAgenda(params: { professionalId: string; date: string; generatedBy: string }) {
  const [{ centerName, timezone }, professional, appointments] = await Promise.all([
    settings(),
    db.professional.findUniqueOrThrow({ where: { id: params.professionalId }, include: { specialty: true } }),
    dayAppointments(params.date, { professionalId: params.professionalId }),
  ]);

  const pdf: PdfAgenda = {
    centerName,
    title: `Agenda del día · ${professional.name}`,
    subtitle: `${professional.specialty.name} · ${dateLabel(params.date)} · ${plural(appointments.length)}`,
    columns: [
      { header: "Hora", width: 62 },
      { header: "Paciente", width: 140 },
      { header: "DNI", width: 62 },
      { header: "Teléfono", width: 82 },
      { header: "Cobertura / Estudio", width: 190 },
      { header: "Tipo", width: 58 },
      { header: "Estado", width: 66 },
      { header: "Observaciones", width: 110 },
    ],
    rows: appointments.map((a) => [
      timeOf(a, timezone),
      `${a.patient.lastName}, ${a.patient.firstName}`,
      a.patient.dni,
      a.patient.phone,
      a.coverage.isOccupational
        ? ["Preocupacional", a.study?.name, a.company].filter(Boolean).join("\n")
        : [a.coverage.name, a.affiliateNumber ? `Afil. ${a.affiliateNumber}` : null].filter(Boolean).join("\n"),
      VISIT_TYPE_LABEL[a.visitType] ?? a.visitType,
      APPOINTMENT_STATUS_LABEL[a.status] ?? a.status,
      observations(a),
    ]),
    emptyMessage: "No hay turnos para este día.",
    footer: footer(centerName, params.generatedBy, timezone),
  };
  return { pdf, professionalName: professional.name, count: appointments.length };
}

/** Agenda de preocupacionales del día, de los profesionales indicados (los que el usuario puede ver). */
export async function occupationalDayAgenda(params: { professionalIds: string[]; date: string; generatedBy: string }) {
  const [{ centerName, timezone }, appointments] = await Promise.all([
    settings(),
    dayAppointments(params.date, { professionalId: { in: params.professionalIds }, coverage: { isOccupational: true } }),
  ]);

  const pdf: PdfAgenda = {
    centerName,
    title: "Agenda de preocupacionales",
    subtitle: `${dateLabel(params.date)} · ${plural(appointments.length)}`,
    columns: [
      { header: "Hora", width: 62 },
      { header: "Paciente", width: 150 },
      { header: "DNI", width: 62 },
      { header: "Teléfono", width: 82 },
      { header: "Empresa", width: 130 },
      { header: "Estudio", width: 120 },
      { header: "Profesional", width: 110 },
      { header: "Estado", width: 66 },
      { header: "Observaciones", width: 100 },
    ],
    rows: appointments.map((a) => [
      timeOf(a, timezone),
      `${a.patient.lastName}, ${a.patient.firstName}`,
      a.patient.dni,
      a.patient.phone,
      a.company ?? "",
      a.study?.name ?? "",
      a.professional.name,
      APPOINTMENT_STATUS_LABEL[a.status] ?? a.status,
      observations(a),
    ]),
    emptyMessage: "No hay turnos preocupacionales para este día.",
    footer: footer(centerName, params.generatedBy, timezone),
  };
  return { pdf, count: appointments.length };
}
