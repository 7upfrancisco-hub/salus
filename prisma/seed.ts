import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { addDaysToDate, todayInZone, weekdayOf, zonedTimeToUtc } from "../src/lib/time";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL (cadena de conexión a PostgreSQL).");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const hm = (h: number, m = 0) => h * 60 + m;
const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5;

async function seedCore() {
  await db.centerSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  // Con un administrador ya creado no se hace nada: si su usuario se renombró (Configuración → Usuarios o
  // scripts/cambiar-usuario.mts), buscarlo por SEED_ADMIN_EMAIL no lo encontraría y se crearía otro con el
  // usuario y la contraseña de arranque, que ya no deberían existir.
  const admins = await db.user.count({ where: { role: "ADMIN" } });
  if (admins > 0) {
    console.log("Ya hay un administrador: no se crea otro.");
    return;
  }

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Definí SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD");

  await db.user.create({
    data: {
      email,
      name: "Administrador",
      role: "ADMIN",
      manageAll: true,
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  console.log(`Administrador creado: ${email}`);
}

/**
 * Datos de ejemplo (profesionales, coberturas y reglas). Opciones por variable de entorno:
 *   SEED_DEMO_USERS=0         no crea los usuarios de ejemplo (sus contraseñas están en este archivo, que es público):
 *                             imprescindible si la base es la de producción.
 *   SEED_DEMO_APPOINTMENTS=1  agrega pacientes y turnos ficticios en los próximos días, para mostrar la agenda y el PDF.
 * Es repetible: las coberturas, especialidades y consultorios que ya existan se reutilizan.
 */
async function seedDemo() {
  if ((await db.professional.count()) > 0) {
    console.log("Ya hay profesionales cargados: no se agregan datos de ejemplo.");
    return;
  }

  const coverage = (data: { name: string; isParticular?: boolean; sortOrder: number; color: string }) =>
    db.coverage.upsert({ where: { name: data.name }, update: {}, create: data });
  const specialty = (data: { name: string; minAgeYears?: number; maxAgeYears?: number }) =>
    db.specialty.upsert({ where: { name: data.name }, update: {}, create: data });
  const office = (name: string) => db.office.upsert({ where: { name }, update: {}, create: { name } });

  const [particular, pami, osde] = await Promise.all([
    coverage({ name: "Particular", isParticular: true, sortOrder: 0, color: "#0d9488" }),
    coverage({ name: "PAMI", sortOrder: 1, color: "#2563eb" }),
    coverage({ name: "OSDE", sortOrder: 2, color: "#ea580c" }),
  ]);

  const [trauma, pedia, neuro] = await Promise.all([
    specialty({ name: "Traumatología" }),
    specialty({ name: "Pediatría", minAgeYears: 0, maxAgeYears: 17 }),
    specialty({ name: "Neurología" }),
  ]);

  const [c1, c2, c3] = await Promise.all([office("Consultorio 1"), office("Consultorio 2"), office("Consultorio 3")]);

  const perez = await db.professional.create({ data: { name: "Dr. Pérez", licenseNumber: "MP 1001", specialties: { connect: [{ id: trauma.id }] } } });
  const gomez = await db.professional.create({ data: { name: "Dra. Gómez", licenseNumber: "MP 1002", specialties: { connect: [{ id: pedia.id }] } } });
  const ruiz = await db.professional.create({ data: { name: "Dr. Ruiz", licenseNumber: "MP 1003", specialties: { connect: [{ id: neuro.id }] } } });

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
  // Sus contraseñas son públicas (están en este archivo): en producción se omiten con SEED_DEMO_USERS=0.
  const withUsers = process.env.SEED_DEMO_USERS !== "0";
  if (withUsers) {
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
  }

  let appointments = 0;
  if (process.env.SEED_DEMO_APPOINTMENTS === "1") {
    appointments = await seedDemoAppointments({
      professionals: { perez, gomez, ruiz },
      offices: { perez: c1, gomez: c2, ruiz: c3 },
      coverages: { particular, pami, osde },
    });
  }

  console.log(
    `Datos de ejemplo cargados (3 profesionales, 3 coberturas, 8 reglas, ${withUsers ? "2 usuarios" : "sin usuarios de ejemplo"}, ${appointments} turnos).`,
  );
}

type Id = { id: string };
type DemoContext = {
  professionals: Record<"perez" | "gomez" | "ruiz", Id>;
  offices: Record<"perez" | "gomez" | "ruiz", Id>;
  coverages: Record<"particular" | "pami" | "osde", Id>;
};

/**
 * Pacientes y turnos ficticios en los próximos 10 días, solo en los días y horarios en que cada profesional
 * atiende (los mismos del seed). Se insertan directo, sin pasar por el motor, y no encolan mails.
 * Los DNI (800000xx) y los mails (@example.com) son inventados.
 */
async function seedDemoAppointments(ctx: DemoContext) {
  const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
  const timezone = settings?.timezone ?? "America/Argentina/Buenos_Aires";
  const today = todayInZone(timezone);

  const adults: [string, string, string][] = [
    ["Lucía", "Fernández", "1984-03-12"], ["Martín", "Gómez", "1979-11-02"], ["Carolina", "Rossi", "1991-07-25"],
    ["Diego", "Benítez", "1968-01-30"], ["Valeria", "Acosta", "1987-09-14"], ["Sergio", "Molina", "1975-05-08"],
    ["Norma", "Quiroga", "1952-12-19"], ["Héctor", "Sosa", "1949-04-03"], ["Alicia", "Peralta", "1956-08-21"],
    ["Raúl", "Domínguez", "1961-06-17"], ["Paula", "Ibarra", "1993-02-27"], ["Nicolás", "Herrera", "1988-10-09"],
  ];
  const kids: [string, string, string][] = [["Mateo", "Álvarez", "2018-05-20"], ["Sofía", "Ledesma", "2015-09-03"], ["Joaquín", "Navarro", "2020-01-15"]];
  const pools = { adults, kids };

  const everyone = [...adults, ...kids];
  await db.patient.createMany({
    data: everyone.map(([firstName, lastName, birthDate], i) => ({
      dni: `800000${String(i + 1).padStart(2, "0")}`,
      firstName,
      lastName,
      birthDate,
      email: `ejemplo${i + 1}@example.com`,
      phone: `11 5555 ${String(1000 + i).padStart(4, "0")}`,
    })),
    skipDuplicates: true,
  });
  const patients = await db.patient.findMany({ where: { dni: { startsWith: "800000" } }, orderBy: { dni: "asc" } });
  const pick = (pool: keyof typeof pools, n: number) => {
    const offset = pool === "adults" ? 0 : adults.length;
    return patients[offset + (n % pools[pool].length)];
  };

  const SLOT = { perez: 20, gomez: 30, ruiz: 30 } as const;
  type Plan = {
    pro: keyof typeof SLOT;
    days: number[];
    at: number;
    coverage: keyof DemoContext["coverages"];
    pool: keyof typeof pools;
    patient: number;
    confirmed?: boolean;
    control?: boolean;
  };
  const plans: Plan[] = [
    // Dr. Pérez (lun, mié, vie)
    { pro: "perez", days: [1, 3], at: hm(9), coverage: "pami", pool: "adults", patient: 6, confirmed: true },
    { pro: "perez", days: [1, 3], at: hm(9, 20), coverage: "pami", pool: "adults", patient: 7 },
    { pro: "perez", days: [5], at: hm(9), coverage: "osde", pool: "adults", patient: 2 },
    { pro: "perez", days: [1, 3, 5], at: hm(9, 40), coverage: "osde", pool: "adults", patient: 3, control: true },
    { pro: "perez", days: [1, 3, 5], at: hm(11), coverage: "particular", pool: "adults", patient: 4 },
    { pro: "perez", days: [1, 3, 5], at: hm(11, 20), coverage: "particular", pool: "adults", patient: 5, confirmed: true },
    // Dra. Gómez (pediatría, lun a jue)
    { pro: "gomez", days: [1, 2, 3, 4], at: hm(14), coverage: "osde", pool: "kids", patient: 0, confirmed: true },
    { pro: "gomez", days: [1, 2, 3, 4], at: hm(14, 30), coverage: "osde", pool: "kids", patient: 1 },
    { pro: "gomez", days: [1, 3], at: hm(16), coverage: "particular", pool: "kids", patient: 2 },
    // Dr. Ruiz (mar, jue)
    { pro: "ruiz", days: [4], at: hm(8), coverage: "pami", pool: "adults", patient: 8 },
    { pro: "ruiz", days: [4], at: hm(8, 30), coverage: "pami", pool: "adults", patient: 9 },
    { pro: "ruiz", days: [2], at: hm(8), coverage: "osde", pool: "adults", patient: 10 },
    { pro: "ruiz", days: [2, 4], at: hm(10), coverage: "particular", pool: "adults", patient: 11 },
  ];

  const data = [];
  for (let offset = 1; offset <= 10; offset += 1) {
    const date = addDaysToDate(today, offset);
    const weekday = weekdayOf(date);
    for (const plan of plans.filter((p) => p.days.includes(weekday))) {
      const startsAt = zonedTimeToUtc(date, plan.at, timezone);
      data.push({
        professionalId: ctx.professionals[plan.pro].id,
        coverageId: ctx.coverages[plan.coverage].id,
        patientId: pick(plan.pool, plan.patient + offset).id,
        officeId: ctx.offices[plan.pro].id,
        localDate: date,
        startsAt,
        endsAt: new Date(startsAt.getTime() + SLOT[plan.pro] * 60_000),
        status: plan.confirmed ? "CONFIRMED" : "RESERVED",
        visitType: plan.control ? "CONTROL" : "FIRST",
        source: plan.confirmed ? "STAFF" : "PUBLIC",
      });
    }
  }
  await db.appointment.createMany({ data });
  return data.length;
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
