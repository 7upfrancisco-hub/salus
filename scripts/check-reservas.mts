/**
 * Prueba de integración del servicio de turnos contra la base de desarrollo (con los datos de
 * ejemplo del seed). Crea turnos de prueba con DNI ficticios y los borra al terminar.
 *
 *   npm run check:reservas
 */
import { db } from "../src/lib/db";
import { bookAppointment, cancelAppointment, setAppointmentStatus, type BookInput } from "../src/lib/booking";
import { turnosDisponibles } from "../src/lib/engine/engine";
import { loadEngineContext } from "../src/lib/engine/load";
import { processPendingNotifications } from "../src/lib/notify";
import { addDaysToDate, todayInZone, weekdayOf } from "../src/lib/time";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ✔" : "  ✘"} ${label}${!ok && detail ? `  → ${detail}` : ""}`);
}

const startedAt = new Date();
const settings = (await db.centerSettings.findUnique({ where: { id: 1 } }))!;
const today = todayInZone(settings.timezone);

/** Primer día de la semana pedida (1 = lunes) que cae al menos 4 días después de hoy. */
function nextWeekday(weekday: number) {
  let d = addDaysToDate(today, 4);
  while (weekdayOf(d) !== weekday) d = addDaysToDate(d, 1);
  return d;
}
const MON = nextWeekday(1);
const WED = nextWeekday(3);
const TUE = nextWeekday(2);

const perez = (await db.professional.findFirstOrThrow({ where: { name: "Dr. Pérez" } }));
const gomez = (await db.professional.findFirstOrThrow({ where: { name: "Dra. Gómez" } }));
const ruiz = (await db.professional.findFirstOrThrow({ where: { name: "Dr. Ruiz" } }));
const pami = await db.coverage.findFirstOrThrow({ where: { name: "PAMI" } });
const osde = await db.coverage.findFirstOrThrow({ where: { name: "OSDE" } });
const secretary = await db.user.findUniqueOrThrow({ where: { email: "secretaria@salus.local" } });
const actor = { id: secretary.id, role: secretary.role, manageAll: secretary.manageAll };

let n = 0;
const patient = (extra: Partial<BookInput["patient"]> = {}): BookInput["patient"] => ({
  dni: `9000${String(++n).padStart(4, "0")}`,
  firstName: "Prueba",
  lastName: `Paciente${n}`,
  birthDate: "1960-03-15",
  email: `prueba${n}@example.com`,
  phone: "11 2345 6789",
  ...extra,
});

const book = (extra: Partial<BookInput>) =>
  bookAppointment({
    professionalId: perez.id,
    coverageId: pami.id,
    date: MON,
    startMinutes: 9 * 60,
    patient: patient(),
    source: "PUBLIC",
    ...extra,
  });

try {
  console.log("\nReserva online");
  const first = await book({});
  check("reserva un horario libre", first.ok);
  const firstPatient = first.ok ? await db.appointment.findUniqueOrThrow({ where: { id: first.appointment.id }, include: { patient: true } }) : null;
  check("queda RESERVADO y es primera vez", firstPatient?.status === "RESERVED" && firstPatient.visitType === "FIRST");
  check("encola confirmación y recordatorio", (await db.notificationLog.count({ where: { appointmentId: firstPatient?.id } })) === 2);

  const same = await book({});
  check("no deja reservar el mismo horario dos veces", !same.ok && same.code === "SLOT_UNAVAILABLE", JSON.stringify(same));

  const mismatch = await book({ startMinutes: 9 * 60 + 20, patient: patient({ dni: firstPatient!.patient.dni, birthDate: "1999-01-01" }) });
  check("rechaza un DNI ya registrado con otra fecha de nacimiento", !mismatch.ok && mismatch.code === "DNI_MISMATCH", JSON.stringify(mismatch));

  const second = await book({ startMinutes: 9 * 60 + 20 });
  check("segunda reserva PAMI del día", second.ok);
  const third = await book({ startMinutes: 9 * 60 + 40 });
  check("la tercera PAMI del día es rechazada por el cupo (2 por día)", !third.ok && third.code === "SLOT_UNAVAILABLE", JSON.stringify(third));
  const otherCoverage = await book({ coverageId: osde.id, startMinutes: 9 * 60 + 40 });
  check("OSDE sigue pudiendo reservar ese día", otherCoverage.ok);

  console.log("\nSecretaría: sobreturnos y saltos de regla");
  const noOverride = await book({ source: "STAFF", actor, startMinutes: 10 * 60 + 20 });
  check("sin override avisa qué regla no se cumple", !noOverride.ok && noOverride.code === "NEEDS_OVERRIDE", JSON.stringify(noOverride));
  const shortReason = await book({ source: "STAFF", actor, startMinutes: 10 * 60 + 20, override: { reason: "ok" } });
  check("exige un motivo de al menos 5 caracteres", !shortReason.ok && shortReason.code === "OVERRIDE_REASON_REQUIRED");
  const withOverride = await book({ source: "STAFF", actor, startMinutes: 10 * 60 + 20, override: { reason: "Paciente derivado por el director" } });
  check("con motivo, da el turno salteando el cupo", withOverride.ok, JSON.stringify(withOverride));
  if (withOverride.ok) {
    const row = await db.appointment.findUniqueOrThrow({ where: { id: withOverride.appointment.id } });
    check("queda marcado como override con motivo y quién lo dio", row.isOverride && row.overrideReason === "Paciente derivado por el director" && row.createdById === secretary.id && row.status === "CONFIRMED");
    check("registra la regla salteada", row.overrideRules === JSON.stringify(["QUOTA_FULL"]), String(row.overrideRules));
    const audited = await db.auditLog.count({ where: { entityId: row.id, action: "APPOINTMENT_CREATED_OVERRIDE", userId: secretary.id } });
    check("queda en el registro de auditoría", audited === 1);
  }
  const overbook = await book({ source: "STAFF", actor, startMinutes: 9 * 60, patient: patient(), override: { reason: "Sobreturno urgente" } });
  check("permite un sobreturno sobre un horario ocupado", overbook.ok, JSON.stringify(overbook));

  const holiday = await db.scheduleException.create({
    data: { kind: "HOLIDAY", dateFrom: WED, dateTo: WED, note: "feriado de prueba" },
  });
  const onHoliday = await book({ source: "STAFF", actor, date: WED, startMinutes: 9 * 60, override: { reason: "Quiero atender igual" } });
  check("un feriado no se puede saltear con override", !onHoliday.ok && onHoliday.code === "NOT_OVERRIDABLE", JSON.stringify(onHoliday));
  await db.scheduleException.delete({ where: { id: holiday.id } });

  const forbidden = await bookAppointment({
    professionalId: ruiz.id, coverageId: osde.id, date: TUE, startMinutes: 8 * 60, patient: patient(), source: "STAFF", actor,
  });
  check("un usuario de secretaría no puede dar turnos a un profesional que no tiene asignado", !forbidden.ok && forbidden.code === "FORBIDDEN");

  console.log("\nPediatría: rango de edad");
  const adultWithPediatrician = await bookAppointment({
    professionalId: gomez.id, coverageId: osde.id, date: MON, startMinutes: 14 * 60,
    patient: patient({ birthDate: "1990-01-01" }), source: "PUBLIC",
  });
  check("un adulto no puede reservar con pediatría", !adultWithPediatrician.ok, JSON.stringify(adultWithPediatrician));
  const child = await bookAppointment({
    professionalId: gomez.id, coverageId: osde.id, date: MON, startMinutes: 14 * 60,
    patient: patient({ birthDate: "2018-06-01" }), source: "PUBLIC",
  });
  check("un menor sí puede", child.ok, JSON.stringify(child));

  console.log("\nCancelación, cupo y lista de espera");
  // Se usa un día limpio (miércoles): PAMI 2 por día, cancelar libera el cupo.
  const w1 = await book({ date: WED });
  const w2 = await book({ date: WED, startMinutes: 9 * 60 + 20 });
  const w3full = await book({ date: WED, startMinutes: 9 * 60 + 40 });
  check("el miércoles también se cierra al segundo turno PAMI", w1.ok && w2.ok && !w3full.ok);

  const waiting = await db.waitlistEntry.create({
    data: {
      patientId: (await db.patient.create({ data: { dni: "90009999", firstName: "En", lastName: "Espera", birthDate: "1955-01-01", email: "espera@example.com", phone: "1122334455" } })).id,
      coverageId: pami.id,
      specialtyId: perez.specialtyId,
    },
  });
  const w1id = w1.ok ? w1.appointment.id : "";
  check("otro usuario sin acceso no puede cancelar el turno", !(await cancelAppointment({ appointmentId: w1id, by: "STAFF", actor: { id: "x", role: "SECRETARY", manageAll: false }, reason: "prueba" })).ok);
  check("secretaría debe indicar el motivo", !(await cancelAppointment({ appointmentId: w1id, by: "STAFF", actor })).ok);
  const cancelled = await cancelAppointment({ appointmentId: w1id, by: "STAFF", actor, reason: "El paciente avisó que no puede" });
  check("cancela con motivo", cancelled.ok);
  const reopened = await book({ date: WED, startMinutes: 9 * 60 + 40 });
  check("al cancelar se libera el cupo del día", reopened.ok, JSON.stringify(reopened));
  const entry = await db.waitlistEntry.findUniqueOrThrow({ where: { id: waiting.id } });
  check("avisa al primero de la lista de espera", entry.status === "NOTIFIED");
  check("encola el mail de lista de espera", (await db.notificationLog.count({ where: { waitlistEntryId: waiting.id, kind: "WAITLIST" } })) === 1);

  if (w2.ok) {
    const early = await cancelAppointment({ token: w2.appointment.manageToken, by: "PATIENT" });
    check("el paciente puede cancelar con anticipación", early.ok);
  }

  // Cancelar dos veces (o dos personas a la vez) no repite el aviso ni la auditoría.
  await Promise.all([
    cancelAppointment({ appointmentId: w1id, by: "STAFF", actor, reason: "Cancelación repetida" }),
    cancelAppointment({ appointmentId: w1id, by: "STAFF", actor, reason: "Cancelación repetida" }),
  ]);
  check("cancelar de nuevo un turno cancelado no manda otro aviso", (await db.notificationLog.count({ where: { appointmentId: w1id, kind: "CANCELLATION" } })) === 1);

  // Quien estaba en la lista de espera y consigue turno deja de figurar como esperando.
  const waitingPatient = await db.patient.findFirstOrThrow({ where: { dni: "90009999" } });
  const booked = await book({
    date: WED,
    startMinutes: 9 * 60,
    patient: patient({ dni: waitingPatient.dni, birthDate: waitingPatient.birthDate, email: "espera@example.com" }),
  });
  check("el paciente de la lista de espera consigue turno", booked.ok, JSON.stringify(booked));
  check("y su lugar en la lista pasa a «sacó turno»", (await db.waitlistEntry.findUniqueOrThrow({ where: { id: waiting.id } })).status === "BOOKED");

  console.log("\nVarios pacientes a la vez");
  {
    // Seis pedidos simultáneos por el mismo horario: tiene que entrar uno solo.
    const context = (await loadEngineContext({ professionalId: perez.id, from: MON, to: WED }))!;
    const freeDay = turnosDisponibles(context.inputFor({ coverageId: osde.id, visitType: "FIRST", audience: "patient" })).days[0];
    const free = freeDay?.slots[0];
    if (!freeDay || !free) {
      check("hay un horario libre para probar la concurrencia", false, `sin horarios libres entre ${MON} y ${WED}`);
    } else {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => book({ coverageId: osde.id, date: freeDay.date, startMinutes: free.startMinutes })),
      );
      check("de 6 pedidos simultáneos por el mismo horario entra uno solo", results.filter((r) => r.ok).length === 1, results.map((r) => (r.ok ? "OK" : r.code)).join(","));
      const saved = await db.appointment.count({ where: { professionalId: perez.id, startsAt: free.startsAt, status: { not: "CANCELLED" } } });
      check("y queda un único turno guardado en la base", saved === 1, String(saved));
    }
  }

  console.log("\nEstados");
  if (otherCoverage.ok) {
    const early = await setAppointmentStatus({ appointmentId: otherCoverage.appointment.id, status: "ATTENDED", actor });
    check("no se puede marcar atendido un turno futuro", !early.ok);
    const confirmed = await setAppointmentStatus({ appointmentId: otherCoverage.appointment.id, status: "CONFIRMED", actor });
    check("reservado → confirmado", confirmed.ok);
  }

  console.log("\nMails (sin RESEND_API_KEY no se envía nada)");
  const result = await processPendingNotifications();
  check("procesa la cola sin errores y sin mandar mails reales", result.sent === 0 && result.failed === 0, JSON.stringify(result));
} finally {
  // Limpieza: solo lo creado por esta prueba.
  const ids = (await db.patient.findMany({ where: { dni: { startsWith: "9000" } }, select: { id: true } })).map((p) => p.id);
  await db.notificationLog.deleteMany({ where: { OR: [{ appointment: { patientId: { in: ids } } }, { waitlistEntry: { patientId: { in: ids } } }] } });
  await db.waitlistEntry.deleteMany({ where: { patientId: { in: ids } } });
  await db.appointment.deleteMany({ where: { patientId: { in: ids } } });
  await db.patient.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, entity: { in: ["Appointment", "Patient"] } } });
  await db.$disconnect();
}

console.log(failures === 0 ? "\nTodo en orden ✔" : `\n${failures} verificación(es) fallaron ✘`);
process.exit(failures === 0 ? 0 : 1);
