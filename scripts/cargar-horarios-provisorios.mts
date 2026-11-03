/**
 * Carga horarios y reglas PROVISORIOS para mostrar el turnero funcionando mientras no estén los datos reales
 * del centro. Los días, horarios, consultorios y obras sociales de acá son inventados: hay que reemplazarlos.
 *
 * Qué crea: las coberturas Particular, OSDE y PAMI, tres consultorios y, para cinco profesionales ya cargados
 * (se buscan por nombre), su agenda semanal y las reglas por cobertura. Un profesional que ya tiene agenda se
 * saltea, así que es repetible y nunca pisa horarios reales.
 *
 * Con --quitar borra la agenda y las reglas de esos cinco profesionales (no toca turnos, pacientes ni catálogos).
 *
 * Uso (PowerShell), con la cadena de conexión de la base — NO se lee de .env.local:
 *   $env:DATABASE_URL = "postgresql://..."
 *   npx tsx scripts/cargar-horarios-provisorios.mts            # carga
 *   npx tsx scripts/cargar-horarios-provisorios.mts --quitar   # deja a esos profesionales sin agenda
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Falta DATABASE_URL: definila en esta terminal con la cadena de conexión de la base.");
  process.exit(1);
}

const remove = process.argv.includes("--quitar");
const target = new URL(connectionString);
console.log(`Base: ${target.hostname}${target.pathname}\n`);

const hm = (h: number, m = 0) => h * 60 + m;
const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5;

type Plan = {
  name: string;
  office: string;
  days: number[];
  from: number;
  to: number;
  slot: number;
  osde?: { from: number; to: number };
  pami?: { from: number; to: number; maxPerDay: number };
};

const PLANS: Plan[] = [
  { name: "Dra. María Becq", office: "Consultorio 1", days: [MON, WED, FRI], from: hm(8), to: hm(12), slot: 20,
    osde: { from: hm(8), to: hm(10) }, pami: { from: hm(8), to: hm(10), maxPerDay: 3 } },
  { name: "Dra. Mariela Tassello", office: "Consultorio 1", days: [TUE, THU], from: hm(14), to: hm(18), slot: 20,
    osde: { from: hm(14), to: hm(16) } },
  { name: "Dra. Nilda Cobo", office: "Consultorio 2", days: [MON, THU], from: hm(9), to: hm(13), slot: 20,
    osde: { from: hm(9), to: hm(11) } },
  { name: "Dra. Sonia Maldonado", office: "Consultorio 3", days: [MON, TUE, WED], from: hm(14), to: hm(18), slot: 20,
    osde: { from: hm(14), to: hm(16) } },
  { name: "Dra. Silvana Morelli", office: "Consultorio 3", days: [THU, FRI], from: hm(9), to: hm(13), slot: 20,
    osde: { from: hm(9), to: hm(11) } },
];

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  if (remove) {
    let removed = 0;
    for (const plan of PLANS) {
      const professional = await db.professional.findFirst({ where: { name: plan.name } });
      if (!professional) continue;
      const blocks = await db.agendaBlock.deleteMany({ where: { professionalId: professional.id } });
      const rules = await db.coverageRule.deleteMany({ where: { professionalId: professional.id } });
      removed += 1;
      console.log(`  - ${plan.name}: ${blocks.count} bloques y ${rules.count} reglas borrados`);
    }
    console.log(`\nListo: ${removed} profesionales sin agenda.`);
  } else {
    const upsertCoverage = (data: { name: string; isParticular?: boolean; sortOrder: number; color: string }) =>
      db.coverage.upsert({ where: { name: data.name }, update: {}, create: data });
    const [particular, osde, pami] = await Promise.all([
      upsertCoverage({ name: "Particular", isParticular: true, sortOrder: 0, color: "#0d9488" }),
      upsertCoverage({ name: "OSDE", sortOrder: 1, color: "#ea580c" }),
      upsertCoverage({ name: "PAMI", sortOrder: 2, color: "#2563eb" }),
    ]);

    let loaded = 0;
    for (const plan of PLANS) {
      const professional = await db.professional.findFirst({ where: { name: plan.name } });
      if (!professional) {
        console.log(`  ? ${plan.name}: no está cargado, se saltea`);
        continue;
      }
      if ((await db.agendaBlock.count({ where: { professionalId: professional.id } })) > 0) {
        console.log(`  = ${plan.name}: ya tiene agenda, no se toca`);
        continue;
      }
      const office = await db.office.upsert({ where: { name: plan.office }, update: {}, create: { name: plan.office } });
      await db.agendaBlock.createMany({
        data: plan.days.map((weekday) => ({
          professionalId: professional.id,
          officeId: office.id,
          weekday,
          startMinutes: plan.from,
          endMinutes: plan.to,
          slotMinutes: plan.slot,
        })),
      });

      const rule = (coverageId: string, from: number, to: number, requirements: string[], maxPerDay?: number) =>
        db.coverageRule.create({
          data: {
            professionalId: professional.id,
            coverageId,
            windows: { create: plan.days.map((weekday) => ({ weekday, startMinutes: from, endMinutes: to })) },
            quotas: { create: maxPerDay ? [{ scope: "PROFESSIONAL", period: "DAY", max: maxPerDay }] : [] },
            requirements: { create: requirements.map((text, sortOrder) => ({ text, sortOrder })) },
          },
        });
      await rule(particular.id, plan.from, plan.to, ["DNI"]);
      if (plan.osde) await rule(osde.id, plan.osde.from, plan.osde.to, ["Orden médica", "DNI y credencial de OSDE"]);
      if (plan.pami) await rule(pami.id, plan.pami.from, plan.pami.to, ["Orden de PAMI vigente", "DNI y credencial"], plan.pami.maxPerDay);

      loaded += 1;
      console.log(`  + ${plan.name}: ${plan.days.length} días, ${plan.office}`);
    }
    await db.auditLog.create({ data: { action: "PROVISIONAL_SCHEDULES_LOADED", entity: "Professional", details: JSON.stringify({ loaded }) } });
    console.log(`\nListo: ${loaded} profesionales con agenda provisoria. Reemplazalos con los datos reales del centro.`);
  }
} finally {
  await db.$disconnect();
}
