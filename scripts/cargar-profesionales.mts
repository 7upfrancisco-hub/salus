/**
 * Carga especialidades y profesionales en una base de Salus desde un archivo JSON.
 *
 * El archivo (por defecto scripts/datos/profesionales.json) NO se sube a git: el repo es público y trae
 * nombres y matrículas reales. Un profesional puede tener varias especialidades (comparte la agenda en todas):
 *   [{ "name": "Dra. Fulana de Tal", "licenseNumber": "12345", "specialties": ["Pediatría", "Alergia"] }]
 *
 * Es repetible: las especialidades que ya existen se reutilizan y un profesional con el mismo nombre y matrícula
 * no se duplica (si ya estaba, solo se le suman las especialidades que le falten). Nunca borra nada.
 * Quedan sin horarios ni reglas: se cargan desde Configuración (hasta entonces no ofrecen turnos online).
 *
 * Uso (PowerShell), con la cadena de conexión de la base — NO se lee de .env.local:
 *   $env:DATABASE_URL = "postgresql://..."
 *   npx tsx scripts/cargar-profesionales.mts [ruta.json]
 */
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Falta DATABASE_URL: definila en esta terminal con la cadena de conexión de la base.");
  process.exit(1);
}

type Entry = { name: string; licenseNumber?: string; specialties: string[] };
const file = process.argv[2] ?? new URL("./datos/profesionales.json", import.meta.url);
const entries = JSON.parse(readFileSync(file, "utf8")) as Entry[];

const target = new URL(connectionString);
console.log(`Base: ${target.hostname}${target.pathname}\n`);

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  await db.$transaction(async (tx) => {
    for (const entry of entries) {
      if (entry.specialties.length === 0) throw new Error(`${entry.name}: falta al menos una especialidad.`);
      const specialties = [];
      for (const name of entry.specialties) {
        specialties.push(await tx.specialty.upsert({ where: { name }, update: {}, create: { name } }));
      }
      const label = `${entry.name}${entry.licenseNumber ? ` · Mat. ${entry.licenseNumber}` : ""} — ${entry.specialties.join(" / ")}`;

      const existing = await tx.professional.findFirst({
        where: { name: entry.name, licenseNumber: entry.licenseNumber ?? null },
        include: { specialties: { select: { id: true } } },
      });
      if (!existing) {
        await tx.professional.create({
          data: { name: entry.name, licenseNumber: entry.licenseNumber ?? null, specialties: { connect: specialties.map((s) => ({ id: s.id })) } },
        });
        created += 1;
        console.log(`  + ${label}`);
        continue;
      }
      const missing = specialties.filter((s) => !existing.specialties.some((e) => e.id === s.id));
      if (missing.length === 0) {
        unchanged += 1;
        console.log(`  = ${label} (ya estaba)`);
        continue;
      }
      await tx.professional.update({ where: { id: existing.id }, data: { specialties: { connect: missing.map((s) => ({ id: s.id })) } } });
      updated += 1;
      console.log(`  ~ ${label} (se sumaron: ${missing.map((s) => s.name).join(", ")})`);
    }
    await tx.auditLog.create({
      data: { action: "PROFESSIONALS_IMPORTED", entity: "Professional", details: JSON.stringify({ created, updated, unchanged }) },
    });
  }, { maxWait: 30_000, timeout: 120_000 }); // contra Neon el arranque de la transacción puede pasar los 2 s por defecto
  console.log(`\nListo: ${created} agregados, ${updated} actualizados, ${unchanged} ya estaban.`);
} finally {
  await db.$disconnect();
}
