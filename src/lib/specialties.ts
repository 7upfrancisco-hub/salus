/** Las especialidades de un profesional, para mostrarlas juntas (puede tener más de una). */
export const specialtyNames = (professional: { specialties: { name: string }[] }) =>
  professional.specialties
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b, "es"))
    .join(" / ");
