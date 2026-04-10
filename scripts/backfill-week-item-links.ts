/**
 * Backfill week_items.project_id for items that have a client but no project link.
 *
 * Uses the same fuzzy matching logic as seed-runway.ts to link week items
 * to their most likely project based on title similarity.
 *
 * Usage:
 *   npx tsx scripts/backfill-week-item-links.ts          # dry-run (preview only)
 *   npx tsx scripts/backfill-week-item-links.ts --apply   # commit changes to DB
 *
 * Requires: RUNWAY_DATABASE_URL in .env.local
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { loadEnvLocal } from "./lib/load-env";

loadEnvLocal();

import { projects, weekItems } from "../src/lib/db/runway-schema";
import { findProjectIdForWeekItem } from "./seed-runway";

const url = process.env.RUNWAY_DATABASE_URL ?? "file:runway-local.db";
const client = createClient({ url, authToken: process.env.RUNWAY_AUTH_TOKEN });
const db = drizzle(client);

const applyMode = process.argv.includes("--apply");
const verboseMode = process.argv.includes("--verbose");

async function backfill() {
  console.log(`Mode: ${applyMode ? "APPLY (will write to DB)" : "DRY-RUN (preview only)"}`);
  console.log(`Database: ${url}\n`);

  // 1. Get all week items, then filter to unlinked ones
  const allWeekItems = await db.select().from(weekItems);
  const unlinked = allWeekItems.filter((item) => item.projectId === null);
  const withClient = unlinked.filter((item) => item.clientId !== null);

  console.log(`Total week items: ${allWeekItems.length}`);
  console.log(`Unlinked (projectId IS NULL): ${unlinked.length}`);
  console.log(`Unlinked with clientId: ${withClient.length}\n`);

  if (withClient.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // 2. Load all projects, grouped by clientId
  const allProjects = await db.select().from(projects);
  const projectsByClient = new Map<string, { id: string; name: string }[]>();
  for (const p of allProjects) {
    const list = projectsByClient.get(p.clientId) ?? [];
    list.push({ id: p.id, name: p.name });
    projectsByClient.set(p.clientId, list);
  }

  // 3. Match each unlinked item
  let matched = 0;
  let unmatched = 0;

  for (const item of withClient) {
    const projectId = findProjectIdForWeekItem(
      item.clientId!,
      item.title,
      projectsByClient
    );

    if (projectId) {
      const project = allProjects.find((p) => p.id === projectId);
      console.log(`  MATCH: "${item.title}" -> ${project?.name ?? projectId}`);
      if (verboseMode && project) {
        console.log(`         Reason: project "${project.name}" matched in client ${item.clientId}`);
      }

      if (applyMode) {
        await db
          .update(weekItems)
          .set({ projectId })
          .where(eq(weekItems.id, item.id));
      }
      matched++;
    } else {
      console.log(`  SKIP:  "${item.title}" (no matching project for client ${item.clientId})`);
      unmatched++;
    }
  }

  console.log(`\nResults: ${matched} matched, ${unmatched} unmatched`);
  if (!applyMode && matched > 0) {
    console.log("\nReview the matches above carefully before running with --apply.");
    console.log("Incorrect links will cause cascades to update wrong week items.");
  }
}

backfill().catch(console.error);
