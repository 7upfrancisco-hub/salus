import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Modelo de caché clásico: casi todo en Salus depende de la sesión o de la base de datos.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
