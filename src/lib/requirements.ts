import "server-only";
import { db } from "@/lib/db";
import { resolveRule } from "@/lib/engine/engine";

/** Requisitos que debe presentar el paciente según la regla que rige para ese profesional y cobertura. */
export async function getRequirements(professionalId: string, coverageId: string): Promise<string[]> {
  const professional = await db.professional.findUnique({
    where: { id: professionalId },
    select: { id: true, specialties: { select: { id: true } } },
  });
  if (!professional) return [];
  const specialtyIds = professional.specialties.map((s) => s.id);

  const rules = await db.coverageRule.findMany({
    where: {
      coverageId,
      OR: [{ professionalId }, { professionalId: null, specialtyId: { in: specialtyIds } }],
    },
    select: {
      coverageId: true,
      professionalId: true,
      specialtyId: true,
      active: true,
      requirements: { orderBy: { sortOrder: "asc" }, select: { text: true } },
    },
  });

  const rule = resolveRule({ professional: { id: professional.id, specialtyIds }, coverageId, rules });
  return rule?.requirements.map((r) => r.text) ?? [];
}
