/**
 * Migrate pipeline items from 'no-sow' to 'at-risk' status.
 *
 * Usage: export $(grep -v '^#' .env.local | xargs) && npx tsx scripts/fix-no-sow-status.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env.local not found
}

import { pipelineItems } from "../src/lib/db/runway-schema";

const url = process.env.RUNWAY_DATABASE_URL ?? "file:runway-local.db";
const client = createClient({ url, authToken: process.env.RUNWAY_AUTH_TOKEN });
const db = drizzle(client);

async function run() {
  console.log("Migrating no-sow → at-risk...");
  const items = await db.select().from(pipelineItems).where(eq(pipelineItems.status, "no-sow"));
  console.log(`Found ${items.length} items with no-sow status`);
  for (const item of items) {
    await db.update(pipelineItems).set({ status: "at-risk" }).where(eq(pipelineItems.id, item.id));
    console.log(`  Fixed: "${item.name}"`);
  }
  console.log("Done.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
