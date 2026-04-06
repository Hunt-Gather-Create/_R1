import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./runway-schema";

function getRunwayClient() {
  const url = process.env.RUNWAY_DATABASE_URL;
  if (!url) {
    throw new Error(
      "RUNWAY_DATABASE_URL is not set. Runway requires a separate Turso database."
    );
  }

  return createClient({
    url,
    authToken: process.env.RUNWAY_AUTH_TOKEN,
  });
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getRunwayDb() {
  if (!_db) {
    _db = drizzle(getRunwayClient(), { schema });
  }
  return _db;
}

// Direct export for convenience in server components / actions
export const runwayDb = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return (getRunwayDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
