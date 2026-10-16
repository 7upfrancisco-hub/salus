import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Falta DATABASE_URL (cadena de conexión a PostgreSQL).");
  // En Vercel cada ejecución es corta: un pool chico evita agotar las conexiones de la base.
  const adapter = new PrismaPg({ connectionString, max: process.env.VERCEL ? 1 : 10 });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
