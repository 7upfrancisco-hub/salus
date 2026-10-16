/**
 * Muestra la disponibilidad real (la que sale del motor con los datos de la base) para un
 * profesional y una cobertura, sin necesidad de pantallas.
 *
 *   npm run turnos -- perez PAMI                 -> próximos 14 días, control, vista de secretaría
 *   npm run turnos -- perez PAMI primera 21      -> primera vez, 21 días
 *   npm run turnos -- perez PAMI control 14 paciente   -> con los límites del turnero online
 */
import { db } from "../src/lib/db";
import { loadEngineInput } from "../src/lib/engine/load";
import { evaluarAgenda, turnosDisponibles } from "../src/lib/engine/engine";
import { SLOT_STATUS } from "../src/lib/engine/types";
import { addDaysToDate, minutesToTime, todayInZone } from "../src/lib/time";

const [professionalQuery, coverageQuery, visit = "control", daysArg = "14", audienceArg = "staff"] = process.argv.slice(2);
if (!professionalQuery || !coverageQuery) {
  console.error("Uso: npm run turnos -- <profesional> <cobertura> [control|primera] [días] [staff|paciente]");
  process.exit(1);
}

// Búsqueda sin tildes ni mayúsculas: "perez" encuentra a "Dr. Pérez".
const norm = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const professional = (await db.professional.findMany({ where: { active: true }, include: { specialty: true } })).find((p) =>
  norm(p.name).includes(norm(professionalQuery)),
);
const coverage = (await db.coverage.findMany()).find((c) => norm(c.name).includes(norm(coverageQuery)));
if (!professional || !coverage) {
  console.error(`No encontré ${!professional ? "el profesional" : "la cobertura"}.`);
  process.exit(1);
}

const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
const today = todayInZone(settings?.timezone ?? "America/Argentina/Buenos_Aires");
const input = await loadEngineInput({
  professionalId: professional.id,
  coverageId: coverage.id,
  visitType: visit === "primera" ? "FIRST" : "CONTROL",
  from: today,
  to: addDaysToDate(today, Number(daysArg) - 1),
  audience: audienceArg === "paciente" ? "patient" : "staff",
});
if (!input) throw new Error("No se pudo armar la agenda");

const { rule, days } = evaluarAgenda(input);
const available = new Map(turnosDisponibles(input).days.map((d) => [d.date, d.slots]));

console.log(`\n${professional.name} (${professional.specialty.name}) · ${coverage.name} · ${visit === "primera" ? "primera vez" : "control"}`);
if (!rule) console.log("Este profesional NO atiende esta cobertura (no hay regla).");
else if (rule.requirements.length) console.log(`Requisitos: ${rule.requirements.join(" · ")}`);

const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
for (const day of days) {
  if (day.slots.length === 0) continue;
  const free = (available.get(day.date) ?? []).map((s) => minutesToTime(s.startMinutes));
  const counters = day.quotas.map((q) => `${q.period === "DAY" ? "día" : q.period === "WEEK" ? "semana" : "mes"} ${q.used}/${q.max}`).join(" · ");
  const reasons = new Map<string, number>();
  for (const s of day.slots) if (s.status !== SLOT_STATUS.AVAILABLE) reasons.set(s.status, (reasons.get(s.status) ?? 0) + 1);
  console.log(
    `\n${WEEKDAY[day.weekday]} ${day.date}  ${counters ? `[cupos: ${counters}] ` : ""}${day.closedBy ? `[cerrado: ${day.closedBy.kind}]` : ""}`,
  );
  console.log(`  libres (${free.length}): ${free.join(" ") || "—"}`);
  console.log(`  descartados: ${[...reasons].map(([k, n]) => `${k}×${n}`).join(", ") || "—"}`);
}
await db.$disconnect();
