import type { Config } from "drizzle-kit";

const isLocal = !process.env.RUNWAY_DATABASE_URL;

export default {
  schema: "./src/lib/db/runway-schema.ts",
  out: "./drizzle-runway",
  dialect: isLocal ? "sqlite" : "turso",
  dbCredentials: isLocal
    ? { url: "file:runway-local.db" }
    : {
        url: process.env.RUNWAY_DATABASE_URL!,
        authToken: process.env.RUNWAY_AUTH_TOKEN,
      },
} satisfies Config;
