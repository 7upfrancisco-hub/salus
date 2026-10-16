import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Las migraciones usan la conexión directa (DIRECT_URL, o DATABASE_URL_UNPOOLED, que inyecta Neon)
    // si existe: los pooladores no soportan todo lo que necesita migrate. La app usa DATABASE_URL.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
});
