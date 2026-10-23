/**
 * Cambia el nombre de ingreso y la contraseña de un usuario de una base de Salus (por ejemplo, el
 * administrador de producción, que arranca con el usuario y la clave del seed).
 *
 * Los datos nuevos se pasan por variables de entorno y NO se guardan en ningún archivo ni en el repo:
 *   NEW_LOGIN     el usuario nuevo (un usuario simple como "mi-usuario", o un email)
 *   NEW_PASSWORD  la contraseña nueva (mínimo 10 caracteres)
 *   CURRENT_LOGIN el usuario a cambiar. Opcional si hay un solo administrador.
 *
 * Uso (PowerShell), con la cadena de conexión de la base — NO se lee de .env.local:
 *   $env:DATABASE_URL = "postgresql://..."
 *   $env:NEW_LOGIN = "mi-usuario"
 *   $env:NEW_PASSWORD = "..."
 *   npx.cmd tsx scripts/cambiar-usuario.mts
 */
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loginNameSchema } from "../src/lib/validation";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Falta DATABASE_URL: definila en esta terminal con la cadena de conexión de la base.");
  process.exit(1);
}

const newLogin = loginNameSchema.safeParse(process.env.NEW_LOGIN ?? "");
const password = process.env.NEW_PASSWORD ?? "";
if (!newLogin.success) {
  console.error(`NEW_LOGIN inválido: ${newLogin.error.issues[0]?.message ?? "revisalo"}`);
  process.exit(1);
}
if (password.length < 10) {
  console.error("NEW_PASSWORD tiene que tener al menos 10 caracteres.");
  process.exit(1);
}

const target = new URL(connectionString);
console.log(`Base: ${target.hostname}${target.pathname}`);

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const currentLogin = process.env.CURRENT_LOGIN?.trim().toLowerCase();
  const candidates = currentLogin
    ? await db.user.findMany({ where: { email: currentLogin } })
    : await db.user.findMany({ where: { role: "ADMIN" } });

  if (candidates.length === 0) {
    console.error(currentLogin ? `No hay ningún usuario «${currentLogin}».` : "No hay ningún administrador.");
    process.exit(1);
  }
  if (candidates.length > 1) {
    console.error(`Hay varios administradores (${candidates.map((u) => u.email).join(", ")}): indicá cuál con CURRENT_LOGIN.`);
    process.exit(1);
  }
  const user = candidates[0];

  const taken = await db.user.findUnique({ where: { email: newLogin.data }, select: { id: true } });
  if (taken && taken.id !== user.id) {
    console.error(`Ya existe otro usuario con el nombre «${newLogin.data}».`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { email: newLogin.data, passwordHash, active: true } });
    // En la auditoría quedan los nombres de ingreso, nunca la contraseña.
    await tx.auditLog.create({
      data: { action: "USER_LOGIN_CHANGED", entity: "User", entityId: user.id, details: JSON.stringify({ from: user.email, to: newLogin.data }) },
    });
  });
  console.log(`Listo: «${user.email}» ahora entra como «${newLogin.data}» con la contraseña nueva.`);
} finally {
  await db.$disconnect();
}
