import "server-only";
import { ACTIVE_STATUSES } from "@/lib/constants";
import { db } from "@/lib/db";
import { utcToZoned, weekdayOf } from "@/lib/time";

/**
 * Cuando se cambia una agenda o se bloquea un día pueden quedar turnos ya dados que se ven
 * afectados. No se cancelan solos (eso lo decide secretaría), pero se avisa cuántos son.
 */

/** Turnos futuros activos de un profesional que ya no entran en ningún bloque de su agenda. */
export async function countAppointmentsOutsideAgenda(professionalId: string, timezone: string) {
  const [blocks, appointments] = await Promise.all([
    db.agendaBlock.findMany({ where: { professionalId, active: true } }),
    db.appointment.findMany({
      where: { professionalId, status: { in: [...ACTIVE_STATUSES] }, startsAt: { gt: new Date() } },
      select: { startsAt: true, endsAt: true, localDate: true },
    }),
  ]);

  return appointments.filter((a) => {
    const start = utcToZoned(a.startsAt, timezone).minutes;
    const end = start + Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
    return !blocks.some(
      (b) =>
        b.weekday === weekdayOf(a.localDate) &&
        (!b.validFrom || a.localDate >= b.validFrom) &&
        (!b.validTo || a.localDate <= b.validTo) &&
        b.startMinutes <= start &&
        end <= b.endMinutes,
    );
  }).length;
}

/** Turnos activos que caen dentro de un bloqueo (de un profesional, o de todo el centro si es null). */
export async function countAppointmentsInRange(
  professionalId: string | null,
  dateFrom: string,
  dateTo: string,
  timezone: string,
  startMinutes?: number | null,
  endMinutes?: number | null,
) {
  const appointments = await db.appointment.findMany({
    where: {
      ...(professionalId ? { professionalId } : {}),
      status: { in: [...ACTIVE_STATUSES] },
      localDate: { gte: dateFrom, lte: dateTo },
    },
    select: { startsAt: true, endsAt: true },
  });
  if (startMinutes == null || endMinutes == null) return appointments.length;

  return appointments.filter((a) => {
    const start = utcToZoned(a.startsAt, timezone).minutes;
    const end = start + Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000);
    return start < endMinutes && startMinutes < end;
  }).length;
}
