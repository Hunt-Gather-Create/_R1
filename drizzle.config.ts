import type { Config } from "drizzle-kit";

const isLocal = !process.env.TURSO_DATABASE_URL;

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: isLocal ? "sqlite" : "turso",
  dbCredentials: isLocal
    ? { url: "file:local.db" }
    : {
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
      },
} satisfies Config;
