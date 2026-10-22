import "server-only";
import { APPOINTMENT_STATUS, NOTIFICATION_KIND, NOTIFICATION_STATUS, WAITLIST_STATUS } from "@/lib/constants";
import { db } from "@/lib/db";
import { cancellationEmail, confirmationEmail, formatWhen, reminderEmail, waitlistEmail } from "@/lib/email-templates";
import { isMailConfigured, sendEmail } from "@/lib/mail";
import { getRequirements } from "@/lib/requirements";

type Tx = Pick<typeof db, "notificationLog" | "waitlistEntry">;

/** Dirección pública del sistema, para los links de los mails. */
export function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

// ───────────────────────── Encolar (dentro de la transacción del cambio) ─────────────────────────

/** Al reservar: confirmación inmediata y recordatorio programado. */
export async function enqueueForNewAppointment(
  tx: Tx,
  appointment: { id: string; startsAt: Date },
  email: string | null,
  reminderHoursBefore: number,
) {
  if (!email) return;
  const now = new Date();
  await tx.notificationLog.create({
    data: { kind: NOTIFICATION_KIND.CONFIRMATION, toAddress: email, scheduledFor: now, appointmentId: appointment.id },
  });

  const reminderAt = new Date(appointment.startsAt.getTime() - reminderHoursBefore * 3_600_000);
  if (reminderAt > now) {
    await tx.notificationLog.create({
      data: { kind: NOTIFICATION_KIND.REMINDER, toAddress: email, scheduledFor: reminderAt, appointmentId: appointment.id },
    });
  }
}

export async function enqueueCancellation(tx: Tx, appointmentId: string, email: string | null) {
  if (!email) return;
  await tx.notificationLog.create({
    data: { kind: NOTIFICATION_KIND.CANCELLATION, toAddress: email, scheduledFor: new Date(), appointmentId },
  });
}

/**
 * Cuando se libera un turno, avisa a los primeros pacientes de la lista de espera que coinciden
 * (misma especialidad y cobertura, y ese profesional o "cualquiera"). Devuelve cuántos avisó.
 */
export async function enqueueWaitlistMatches(
  tx: Tx,
  freed: { professionalId: string; specialtyId: string; coverageId: string; startsAt: Date },
  maxToNotify = 3,
) {
  if (freed.startsAt <= new Date()) return 0;

  const entries = await tx.waitlistEntry.findMany({
    where: {
      status: WAITLIST_STATUS.WAITING,
      specialtyId: freed.specialtyId,
      coverageId: freed.coverageId,
      OR: [{ professionalId: null }, { professionalId: freed.professionalId }],
    },
    orderBy: { createdAt: "asc" },
    take: maxToNotify,
    include: { patient: { select: { email: true } } },
  });

  let notified = 0;
  for (const entry of entries) {
    await tx.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: WAITLIST_STATUS.NOTIFIED, notifiedAt: new Date() },
    });
    if (entry.patient.email) {
      await tx.notificationLog.create({
        data: { kind: NOTIFICATION_KIND.WAITLIST, toAddress: entry.patient.email, scheduledFor: new Date(), waitlistEntryId: entry.id },
      });
    }
    notified += 1;
  }
  return notified;
}

// ───────────────────────── Enviar ─────────────────────────

/**
 * Envía los mails pendientes que ya les toca. Está pensado para correrse cada pocos minutos desde
 * un programador de tareas (ver /api/cron/notificaciones). Cada mail se "reclama" antes de enviarse,
 * así que dos ejecuciones simultáneas no mandan el mismo aviso dos veces.
 */
export async function processPendingNotifications(limit = 50) {
  // Sin Resend configurado los mails quedan en la cola (PENDING) en vez de descartarse: cuando se
  // cargue la clave salen los que sigan vigentes. Los que ya no corresponden se saltean al enviarlos.
  if (!isMailConfigured()) return { sent: 0, skipped: 0, failed: 0, mailConfigured: false };

  const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
  const centerName = settings?.name ?? "Salus";
  const timezone = settings?.timezone ?? "America/Argentina/Buenos_Aires";

  const due = await db.notificationLog.findMany({
    where: { status: NOTIFICATION_STATUS.PENDING, scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    select: { id: true },
  });

  const result = { sent: 0, skipped: 0, failed: 0, mailConfigured: true };

  for (const { id } of due) {
    const claimed = await db.notificationLog.updateMany({
      where: { id, status: NOTIFICATION_STATUS.PENDING },
      data: { status: NOTIFICATION_STATUS.SENDING },
    });
    if (claimed.count === 0) continue;

    const log = await db.notificationLog.findUniqueOrThrow({
      where: { id },
      include: {
        appointment: { include: { patient: true, professional: true } },
        waitlistEntry: { include: { patient: true, specialty: true } },
      },
    });

    const finish = (status: string, extra: { providerMessageId?: string | null; error?: string | null } = {}) =>
      db.notificationLog.update({
        where: { id },
        data: { status, sentAt: status === NOTIFICATION_STATUS.SENT ? new Date() : null, ...extra },
      });

    let mail: { subject: string; html: string; text: string } | null = null;

    if (log.appointment) {
      const appt = log.appointment;
      const stillActive =
        appt.status === APPOINTMENT_STATUS.RESERVED || appt.status === APPOINTMENT_STATUS.CONFIRMED;
      const isCancellationMail = log.kind === NOTIFICATION_KIND.CANCELLATION;

      if (!isCancellationMail && !stillActive) {
        await finish(NOTIFICATION_STATUS.SKIPPED, { error: "El turno ya no está activo" });
        result.skipped += 1;
        continue;
      }
      if (log.kind === NOTIFICATION_KIND.REMINDER && appt.startsAt <= new Date()) {
        await finish(NOTIFICATION_STATUS.SKIPPED, { error: "El turno ya pasó" });
        result.skipped += 1;
        continue;
      }

      const data = {
        centerName,
        manageUrl: `${appUrl()}/turno/${appt.manageToken}`,
        patientName: appt.patient.firstName,
        professionalName: appt.professional.name,
        when: formatWhen(appt.startsAt, timezone),
        requirements: isCancellationMail ? [] : await getRequirements(appt.professionalId, appt.coverageId),
      };
      mail =
        log.kind === NOTIFICATION_KIND.REMINDER
          ? reminderEmail(data)
          : isCancellationMail
            ? cancellationEmail({ ...data, manageUrl: appUrl() })
            : confirmationEmail(data);
    } else if (log.waitlistEntry) {
      const entry = log.waitlistEntry;
      mail = waitlistEmail({
        centerName,
        manageUrl: appUrl(),
        patientName: entry.patient.firstName,
        specialtyName: entry.specialty.name,
      });
    }

    if (!mail) {
      await finish(NOTIFICATION_STATUS.SKIPPED, { error: "Sin turno ni lista de espera asociada" });
      result.skipped += 1;
      continue;
    }

    const sent = await sendEmail({ to: log.toAddress, ...mail });
    if (sent.ok) {
      await finish(NOTIFICATION_STATUS.SENT, { providerMessageId: sent.id });
      result.sent += 1;
    } else if (sent.skipped) {
      await finish(NOTIFICATION_STATUS.SKIPPED, { error: sent.error });
      result.skipped += 1;
    } else {
      await finish(NOTIFICATION_STATUS.FAILED, { error: sent.error });
      result.failed += 1;
    }
  }

  return result;
}
