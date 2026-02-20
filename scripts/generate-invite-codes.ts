/**
 * CLI script to generate invite codes.
 *
 * Usage:
 *   npx tsx scripts/generate-invite-codes.ts --count 5 --label "Beta batch 1"
 *   npx tsx scripts/generate-invite-codes.ts --count 10 --expires-in-days 30
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { inviteCodes } from "../src/lib/db/schema";

function parseArgs(args: string[]) {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--") && i + 1 < args.length) {
      parsed[arg.slice(2)] = args[i + 1];
      i++;
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const count = parseInt(args["count"] || "1", 10);
  const label = args["label"] || null;
  const expiresInDays = args["expires-in-days"]
    ? parseInt(args["expires-in-days"], 10)
    : null;

  if (count < 1 || count > 100) {
    console.error("Count must be between 1 and 100");
    process.exit(1);
  }

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const db = drizzle(client);

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  console.log(`Generating ${count} invite code(s)...`);
  if (label) console.log(`Label: ${label}`);
  if (expiresAt) console.log(`Expires: ${expiresAt.toISOString()}`);
  console.log("");

  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(inviteCodes).values({
      id,
      label,
      createdAt: now,
      expiresAt,
    });

    console.log(`${baseUrl}/beta/${id}/claim`);
  }

  console.log(`\nDone! Generated ${count} invite code(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
