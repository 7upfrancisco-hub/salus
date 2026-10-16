import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

const hm = (h: number, m = 0) => h * 60 + m;
const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5;

async function seedCore() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Definí SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD");

  await db.centerSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await db.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Administrador",
      role: "ADMIN",
      manageAll: true,
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  console.log(`Administrador listo: ${email}`);
}

/** Datos de ejemplo para desarrollo. Nunca correr en producción. */
async function seedDemo() {
  if ((await db.professional.count()) > 0) {
    console.log("Ya hay profesionales cargados: no se agregan datos de ejemplo.");
    return;
  }

  const [particular, pami, osde] = await Promise.all([
    db.coverage.create({ data: { name: "Particular", isParticular: true, sortOrder: 0, color: "#0d9488" } }),
    db.coverage.create({ data: { name: "PAMI", sortOrder: 1, color: "#2563eb" } }),
    db.coverage.create({ data: { name: "OSDE", sortOrder: 2, color: "#ea580c" } }),
  ]);

  const [trauma, pedia, neuro] = await Promise.all([
    db.specialty.create({ data: { name: "Traumatología" } }),
    db.specialty.create({ data: { name: "Pediatría", minAgeYears: 0, maxAgeYears: 17 } }),
    db.specialty.create({ data: { name: "Neurología" } }),
  ]);

  const [c1, c2, c3] = await Promise.all([
    db.office.create({ data: { name: "Consultorio 1" } }),
    db.office.create({ data: { name: "Consultorio 2" } }),
    db.office.create({ data: { name: "Consultorio 3" } }),
  ]);

  const perez = await db.professional.create({ data: { name: "Dr. Pérez", licenseNumber: "MP 1001", specialtyId: trauma.id } });
  const gomez = await db.professional.create({ data: { name: "Dra. Gómez", licenseNumber: "MP 1002", specialtyId: pedia.id } });
  const ruiz = await db.professional.create({ data: { name: "Dr. Ruiz", licenseNumber: "MP 1003", specialtyId: neuro.id } });

  // Capa 1: agenda base
  const blocks = (professionalId: string, officeId: string, days: number[], from: number, to: number, slot: number) =>
    days.map((weekday) => ({ professionalId, officeId, weekday, startMinutes: from, endMinutes: to, slotMinutes: slot }));
  await db.agendaBlock.createMany({
    data: [
      ...blocks(perez.id, c1.id, [MON, WED, FRI], hm(9), hm(13), 20),
      ...blocks(gomez.id, c2.id, [MON, TUE, WED, THU], hm(14), hm(18), 30),
      ...blocks(ruiz.id, c3.id, [TUE, THU], hm(8), hm(12), 30),
    ],
  });

  // Capa 2: reglas por cobertura
  type Rule = {
    professionalId: string;
    coverageId: string;
    days: number[];
    from: number;
    to: number;
    quotas?: { period: string; max: number; scope?: string; weekdays?: string }[];
    requirements: string[];
    firstVisitMinutes?: number;
  };
  const rules: Rule[] = [
    // Dr. Pérez: PAMI lun/mié 9-11 (máx. 2 por día y 6 por semana), OSDE 9-11, Particular 11-13
    { professionalId: perez.id, coverageId: pami.id, days: [MON, WED], from: hm(9), to: hm(11),
      quotas: [{ period: "DAY", max: 2 }, { period: "WEEK", max: 6 }],
      requirements: ["Orden PAMI vigente", "DNI y credencial"] },
    { professionalId: perez.id, coverageId: osde.id, days: [MON, WED, FRI], from: hm(9), to: hm(11),
      requirements: ["Orden médica", "DNI y credencial OSDE"], firstVisitMinutes: 40 },
    { professionalId: perez.id, coverageId: particular.id, days: [MON, WED, FRI], from: hm(11), to: hm(13),
      requirements: ["DNI"] },
    // Dra. Gómez (pediatría): OSDE toda la tarde, Particular desde las 16
    { professionalId: gomez.id, coverageId: osde.id, days: [MON, TUE, WED, THU], from: hm(14), to: hm(18),
      requirements: ["DNI del menor", "Credencial OSDE", "Orden médica"] },
    { professionalId: gomez.id, coverageId: particular.id, days: [MON, TUE, WED, THU], from: hm(16), to: hm(18),
      requirements: ["DNI del menor"] },
    // Dr. Ruiz: PAMI solo jueves (máx. 3 por día y 12 por mes), OSDE martes, Particular ambos días
    { professionalId: ruiz.id, coverageId: pami.id, days: [THU], from: hm(8), to: hm(10),
      quotas: [{ period: "DAY", max: 3, weekdays: String(THU) }, { period: "MONTH", max: 12 }],
      requirements: ["Orden PAMI vigente", "Autorización", "DNI y credencial"] },
    { professionalId: ruiz.id, coverageId: osde.id, days: [TUE], from: hm(8), to: hm(10),
      quotas: [{ period: "WEEK", max: 8 }],
      requirements: ["Orden médica", "Credencial OSDE"] },
    { professionalId: ruiz.id, coverageId: particular.id, days: [TUE, THU], from: hm(10), to: hm(12),
      requirements: ["DNI"] },
  ];

  for (const r of rules) {
    await db.coverageRule.create({
      data: {
        professionalId: r.professionalId,
        coverageId: r.coverageId,
        firstVisitMinutes: r.firstVisitMinutes,
        windows: { create: r.days.map((weekday) => ({ weekday, startMinutes: r.from, endMinutes: r.to })) },
        quotas: { create: (r.quotas ?? []).map((q) => ({ scope: "PROFESSIONAL", ...q })) },
        requirements: { create: r.requirements.map((text, sortOrder) => ({ text, sortOrder })) },
      },
    });
  }

  // Usuarios de ejemplo: un usuario de secretaría con dos profesionales y un profesional con su propio acceso.
  const secretary = await db.user.create({
    data: {
      email: "secretaria@salus.local",
      name: "Secretaría de ejemplo",
      role: "SECRETARY",
      passwordHash: await bcrypt.hash("secretaria1234", 12),
    },
  });
  await db.userProfessionalAccess.createMany({
    data: [perez, gomez].map((p) => ({ userId: secretary.id, professionalId: p.id })),
  });
  await db.user.create({
    data: {
      email: "perez@salus.local",
      name: "Dr. Pérez",
      role: "PROFESSIONAL",
      passwordHash: await bcrypt.hash("perez1234", 12),
      professional: { connect: { id: perez.id } },
    },
  });

  console.log("Datos de ejemplo cargados (3 profesionales, 3 coberturas, 8 reglas, 2 usuarios).");
}

async function main() {
  await seedCore();
  if (process.env.SEED_DEMO === "1") await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
