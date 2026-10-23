import "server-only";
import type { VisitType } from "@/lib/constants";
import { db } from "@/lib/db";
import { resolveRule, turnosDisponibles } from "@/lib/engine/engine";
import { loadEngineContext } from "@/lib/engine/load";
import { addDaysToDate, minutesToTime, todayInZone } from "@/lib/time";

/** Datos que ve el paciente en el turnero online. Todo sale del mismo motor que usa secretaría. */

export type SpecialtyOption = { id: string; name: string; minAgeYears: number | null; maxAgeYears: number | null };
export type ProfessionalOption = { id: string; name: string };
export type StudyOption = { id: string; name: string; description: string | null; instructions: string | null };
/** Lo que necesita el turnero para ofrecer el camino "Preocupacional" (null = no hay turnos online). */
export type OccupationalOffer = { coverageId: string; studies: StudyOption[] };

export type PublicSlot = {
  professionalId: string;
  professionalName: string;
  startMinutes: number;
  time: string;
  durationMinutes: number;
};
export type PublicDay = { date: string; slots: PublicSlot[] };

export type PublicAvailability = {
  days: PublicDay[];
  /** Requisitos de la cobertura, por profesional (pueden variar de uno a otro). */
  requirementsByProfessional: Record<string, string[]>;
  /** true si primera vez y control duran distinto: hay que preguntarle al paciente. */
  askVisitType: boolean;
  /** Si no hay turnos con su cobertura: ¿hay con atención particular? */
  particularAlternative: { coverageId: string; name: string } | null;
};

/** Coberturas que elige el paciente en el camino "Personal" (la de preocupacional tiene el suyo). */
export async function listCoverages() {
  return db.coverage.findMany({
    where: { active: true, isOccupational: false },
    orderBy: [{ isParticular: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isParticular: true },
  });
}

/**
 * Profesionales que atienden online esa cobertura (con una regla vigente que los incluya).
 * Con `specialtyId` null se consideran todas las especialidades (preocupacional: no se elige especialidad).
 */
async function eligibleProfessionals(coverageId: string, specialtyId: string | null, onlyProfessionalId?: string) {
  const professionals = await db.professional.findMany({
    where: {
      active: true,
      onlineBooking: true,
      specialty: { active: true },
      ...(specialtyId ? { specialtyId } : {}),
      ...(onlyProfessionalId ? { id: onlyProfessionalId } : {}),
    },
    select: { id: true, name: true, specialtyId: true },
    orderBy: { name: "asc" },
  });
  if (professionals.length === 0) return { professionals: [], rules: [] };

  const rules = await db.coverageRule.findMany({
    where: {
      coverageId,
      OR: [
        { professionalId: { in: professionals.map((p) => p.id) } },
        { professionalId: null, specialtyId: specialtyId ?? { in: [...new Set(professionals.map((p) => p.specialtyId))] } },
      ],
    },
    select: { coverageId: true, professionalId: true, specialtyId: true, active: true, firstVisitMinutes: true, controlMinutes: true },
  });

  return {
    professionals: professionals.filter((p) => resolveRule({ professional: p, coverageId, rules })),
    rules,
  };
}

export async function listSpecialtiesFor(coverageId: string): Promise<SpecialtyOption[]> {
  const specialties = await db.specialty.findMany({
    where: { active: true, professionals: { some: { active: true, onlineBooking: true } } },
    orderBy: { name: "asc" },
  });
  const result: SpecialtyOption[] = [];
  for (const s of specialties) {
    const { professionals } = await eligibleProfessionals(coverageId, s.id);
    if (professionals.length > 0) {
      result.push({ id: s.id, name: s.name, minAgeYears: s.minAgeYears, maxAgeYears: s.maxAgeYears });
    }
  }
  return result;
}

export async function listProfessionalsFor(coverageId: string, specialtyId: string): Promise<ProfessionalOption[]> {
  const { professionals } = await eligibleProfessionals(coverageId, specialtyId);
  return professionals.map((p) => ({ id: p.id, name: p.name }));
}

/** Camino "Preocupacional": la cobertura y los estudios activos, si hay algún profesional que los atienda online. */
export async function getOccupationalOffer(): Promise<OccupationalOffer | null> {
  const coverage = await db.coverage.findFirst({ where: { isOccupational: true, active: true }, select: { id: true } });
  if (!coverage) return null;
  const studies = await db.occupationalStudy.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, instructions: true },
  });
  if (studies.length === 0) return null;
  const { professionals } = await eligibleProfessionals(coverage.id, null);
  return professionals.length > 0 ? { coverageId: coverage.id, studies } : null;
}

/** Turnos libres de preocupacional: los de cualquier profesional con regla para la cobertura "Preocupacional". */
export async function searchOccupationalAvailability(): Promise<PublicAvailability> {
  const coverage = await db.coverage.findFirst({ where: { isOccupational: true, active: true }, select: { id: true } });
  if (!coverage) return { days: [], requirementsByProfessional: {}, askVisitType: false, particularAlternative: null };
  return searchAvailability({
    coverageId: coverage.id,
    specialtyId: null,
    professionalId: null,
    visitType: "FIRST",
    includeParticularAlternative: false,
    occupational: true,
  });
}

export async function searchAvailability(params: {
  coverageId: string;
  /** Null = cualquier especialidad (solo preocupacional). */
  specialtyId: string | null;
  /** Id de un profesional, o null para "primero disponible" (cualquiera de la especialidad). */
  professionalId: string | null;
  visitType: VisitType;
  /** Fecha de nacimiento del paciente, si la especialidad tiene rango de edad. */
  birthDate?: string | null;
  includeParticularAlternative?: boolean;
  /** Preocupacional: la duración no depende de si es primera vez o control, así que no se pregunta. */
  occupational?: boolean;
}): Promise<PublicAvailability> {
  const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
  const timezone = settings?.timezone ?? "America/Argentina/Buenos_Aires";
  const from = todayInZone(timezone);
  const to = addDaysToDate(from, settings?.bookingHorizonDays ?? 60);

  const { professionals, rules } = await eligibleProfessionals(
    params.coverageId,
    params.specialtyId,
    params.professionalId ?? undefined,
  );

  const byDate = new Map<string, PublicSlot[]>();
  const requirementsByProfessional: Record<string, string[]> = {};

  for (const professional of professionals) {
    const context = await loadEngineContext({
      professionalId: professional.id,
      from,
      to,
      patientBirthDate: params.birthDate ?? null,
    });
    if (!context) continue;

    const availability = turnosDisponibles(
      context.inputFor({ coverageId: params.coverageId, visitType: params.visitType, audience: "patient" }),
    );
    requirementsByProfessional[professional.id] = availability.requirements;

    for (const day of availability.days) {
      const list = byDate.get(day.date) ?? [];
      for (const slot of day.slots) {
        list.push({
          professionalId: professional.id,
          professionalName: professional.name,
          startMinutes: slot.startMinutes,
          time: minutesToTime(slot.startMinutes),
          durationMinutes: slot.durationMinutes,
        });
      }
      byDate.set(day.date, list);
    }
  }

  const days: PublicDay[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => ({
      date,
      slots: slots.sort((a, b) => a.startMinutes - b.startMinutes || a.professionalName.localeCompare(b.professionalName)),
    }));

  const askVisitType = !params.occupational && rules.some((r) => r.firstVisitMinutes !== null || r.controlMinutes !== null);

  let particularAlternative: PublicAvailability["particularAlternative"] = null;
  if (days.length === 0 && params.includeParticularAlternative !== false) {
    const particular = await db.coverage.findFirst({ where: { isParticular: true, active: true } });
    if (particular && particular.id !== params.coverageId) {
      const alternative = await searchAvailability({ ...params, coverageId: particular.id, includeParticularAlternative: false });
      if (alternative.days.length > 0) particularAlternative = { coverageId: particular.id, name: particular.name };
    }
  }

  return { days, requirementsByProfessional, askVisitType, particularAlternative };
}
