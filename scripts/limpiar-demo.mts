/**
 * Borra los datos de demostración de una base de Salus para dejarla lista para uso real.
 *
 * Qué borra: turnos, pacientes, lista de espera, avisos, horarios, reglas, profesionales, excepciones,
 * auditoría, contadores del límite de pedidos y los usuarios de ejemplo (los que no son ADMIN y terminan
 * en @salus.local). Con --conservar-catalogos deja coberturas, especialidades y consultorios.
 * Qué NO borra: los administradores y la configuración del centro.
 *
 * Por defecto solo muestra qué haría (simulacro). Para borrar de verdad hay que agregar --confirmar.
 *
 * Uso (PowerShell), con la cadena de conexión de la base a limpiar — NO se lee de .env.local:
 *   $env:DATABASE_URL = "postgresql://..."
 *   npx tsx scripts/limpiar-demo.mts                 # simulacro
 *   npx tsx scripts/limpiar-demo.mts --confirmar     # borra
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Falta DATABASE_URL: definila en esta terminal con la cadena de conexión de la base a limpiar.");
  process.exit(1);
}

const confirm = process.argv.includes("--confirmar");
const keepCatalogs = process.argv.includes("--conservar-catalogos");

const target = new URL(connectionString);
console.log(`Base: ${target.hostname}${target.pathname}`);
console.log(confirm ? "Modo: BORRAR de verdad\n" : "Modo: simulacro (no se borra nada; agregá --confirmar para borrar)\n");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const demoUsers = { role: { not: "ADMIN" }, email: { endsWith: "@salus.local" } };
  const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  const otherUsers = await db.user.findMany({
    where: { role: { not: "ADMIN" }, NOT: { email: { endsWith: "@salus.local" } } },
    select: { email: true },
  });

  const counts = {
    "turnos": await db.appointment.count(),
    "pacientes": await db.patient.count(),
    "lista de espera": await db.waitlistEntry.count(),
    "avisos (mails)": await db.notificationLog.count(),
    "profesionales": await db.professional.count(),
    "horarios (bloques)": await db.agendaBlock.count(),
    "reglas de cobertura": await db.coverageRule.count(),
    "excepciones (feriados, licencias)": await db.scheduleException.count(),
    "usuarios de ejemplo": await db.user.count({ where: demoUsers }),
    "registros de auditoría": await db.auditLog.count(),
    ...(keepCatalogs
      ? {}
      : {
          "coberturas": await db.coverage.count(),
          "especialidades": await db.specialty.count(),
          "consultorios": await db.office.count(),
        }),
  };
  console.log("Se borraría:");
  for (const [label, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(5)}  ${label}`);

  console.log(`\nSe conservan los administradores: ${admins.map((a) => a.email).join(", ") || "(ninguno)"}`);
  if (otherUsers.length > 0) console.log(`Se conservan también estos usuarios (no son de ejemplo): ${otherUsers.map((u) => u.email).join(", ")}`);
  for (const a of admins.filter((a) => a.email.endsWith("@salus.local"))) {
    console.warn(`\n⚠ ${a.email} es administrador y su dominio es de ejemplo: si su contraseña es la del README, cambiala (Configuración → Usuarios).`);
  }
  if (admins.length === 0) {
    console.error("\nNo hay ningún administrador: no se borra nada para no dejar la base sin acceso.");
    process.exit(1);
  }

  if (!confirm) {
    console.log("\nSimulacro terminado. Si está todo bien, volvé a correrlo con --confirmar.");
  } else {
    // Todo o nada. El orden respeta las relaciones que impiden borrar (turnos antes que pacientes, etc.).
    await db.$transaction(async (tx) => {
      await tx.notificationLog.deleteMany();
      await tx.appointment.deleteMany();
      await tx.waitlistEntry.deleteMany();
      await tx.patient.deleteMany();
      await tx.scheduleException.deleteMany();
      await tx.overbookAllowance.deleteMany();
      await tx.coverageRule.deleteMany();
      await tx.agendaBlock.deleteMany();
      await tx.professional.deleteMany();
      await tx.user.deleteMany({ where: demoUsers });
      if (!keepCatalogs) {
        await tx.office.deleteMany();
        await tx.specialty.deleteMany();
        await tx.coverage.deleteMany();
      }
      await tx.rateLimitHit.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.auditLog.create({
        data: { action: "DEMO_CLEANED", entity: "System", details: JSON.stringify({ keepCatalogs }) },
      });
    });
    console.log("\nListo: datos de demostración borrados.");
  }
} finally {
  await db.$disconnect();
}
