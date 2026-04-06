/**
 * Seed Runway database from static data.ts
 *
 * Usage: pnpm runway:seed
 * Requires: RUNWAY_DATABASE_URL in .env.local (or falls back to file:runway-local.db)
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

// Load .env.local since tsx doesn't auto-load it
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
  // .env.local not found, rely on existing env vars
}
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
  updates,
  teamMembers,
} from "../src/lib/db/runway-schema";
import {
  accounts,
  thisWeek,
  upcoming,
  pipeline,
} from "../src/app/runway/data";
import { getMondayISODate, parseISODate } from "../src/app/runway/date-utils";

const url = process.env.RUNWAY_DATABASE_URL ?? "file:runway-local.db";
const client = createClient({ url, authToken: process.env.RUNWAY_AUTH_TOKEN });
const db = drizzle(client);

function generateId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 25);
}

const DAY_NAMES: Record<string, string> = {
  "0": "sunday",
  "1": "monday",
  "2": "tuesday",
  "3": "wednesday",
  "4": "thursday",
  "5": "friday",
  "6": "saturday",
};

async function seed() {
  console.log("Seeding Runway database...");
  console.log(`Database: ${url}`);

  // Clear existing data (order matters for foreign keys)
  console.log("  Clearing existing data...");
  await db.delete(updates);
  await db.delete(weekItems);
  await db.delete(pipelineItems);
  await db.delete(projects);
  await db.delete(teamMembers);
  await db.delete(clients);

  // ── 1. Clients ──────────────────────────────────────────────
  const clientMap = new Map<string, string>(); // slug -> id

  for (const account of accounts) {
    const id = generateId();
    clientMap.set(account.slug, id);
    // Also map by name for week items / pipeline matching
    clientMap.set(account.name.toLowerCase(), id);

    await db.insert(clients).values({
      id,
      name: account.name,
      slug: account.slug,
      contractValue: account.contractValue ?? null,
      contractTerm: account.contractTerm ?? null,
      contractStatus: account.contractStatus,
      team: account.team ?? null,
    });
  }
  console.log(`  Clients: ${accounts.length} inserted`);

  // ── 2. Projects ─────────────────────────────────────────────
  let projectCount = 0;
  const projectMap = new Map<string, string>(); // "slug:projectTitle" -> id

  for (const account of accounts) {
    const clientId = clientMap.get(account.slug)!;

    for (let i = 0; i < account.items.length; i++) {
      const item = account.items[i];
      const id = generateId();
      projectMap.set(`${account.slug}:${item.title}`, id);

      await db.insert(projects).values({
        id,
        clientId,
        name: item.title,
        status: item.status,
        category: item.category,
        owner: item.owner ?? null,
        waitingOn: item.waitingOn ?? null,
        target: item.target ?? null,
        notes: item.notes ?? null,
        staleDays: item.staleDays ?? null,
        sortOrder: i,
      });
      projectCount++;
    }
  }
  console.log(`  Projects: ${projectCount} inserted`);

  // ── 3. Week Items ───────────────────────────────────────────
  let weekItemCount = 0;

  // Helper to find client ID by account name
  function findClientId(accountName: string): string | null {
    return clientMap.get(accountName.toLowerCase()) ?? null;
  }

  for (const dayItems of [...thisWeek, ...upcoming]) {
    const weekOf = getMondayISODate(parseISODate(dayItems.date));
    const dayDate = parseISODate(dayItems.date);
    const dayOfWeek = DAY_NAMES[dayDate.getDay().toString()];

    for (let i = 0; i < dayItems.items.length; i++) {
      const item = dayItems.items[i];
      const id = generateId();
      const clientId = findClientId(item.account);

      await db.insert(weekItems).values({
        id,
        clientId,
        dayOfWeek,
        weekOf,
        date: dayItems.date,
        title: item.title,
        category: item.type,
        owner: item.owner ?? null,
        notes: item.notes ?? null,
        sortOrder: i,
      });
      weekItemCount++;
    }
  }
  console.log(`  Week Items: ${weekItemCount} inserted`);

  // ── 4. Pipeline ─────────────────────────────────────────────
  for (let i = 0; i < pipeline.length; i++) {
    const item = pipeline[i];
    const id = generateId();

    // Match client by account name
    const clientId = findClientId(item.account);

    await db.insert(pipelineItems).values({
      id,
      clientId,
      name: item.title,
      status: item.status,
      estimatedValue: item.value,
      waitingOn: item.waitingOn ?? null,
      notes: item.notes ?? null,
      sortOrder: i,
    });
  }
  console.log(`  Pipeline: ${pipeline.length} inserted`);

  // ── 5. Team Members ─────────────────────────────────────────
  const team = [
    { name: "Kathy Horn", title: "Creative Director / Copywriter", channelPurpose: "Creative, copy, client relationships" },
    { name: "Jason Burks", title: "TAP / Strategy", channelPurpose: "Strategy, operations, account management" },
    { name: "Jill Runyon", title: "Director of Client Experience", channelPurpose: "Beyond Petro, AM accounts" },
    { name: "Allison", title: "Account Manager", channelPurpose: "Wilsonart, AM accounts" },
    { name: "Lane", title: "Creative Director", channelPurpose: "Brand, design direction" },
    { name: "Roz", title: "Designer", channelPurpose: "Design execution" },
    { name: "Leslie", title: "Developer / PM", channelPurpose: "Dev, web builds" },
    { name: "Ronan Lane", title: "Senior PM", channelPurpose: "Project management, status tracking" },
  ];

  for (const member of team) {
    await db.insert(teamMembers).values({
      id: generateId(),
      name: member.name,
      title: member.title,
      channelPurpose: member.channelPurpose,
    });
  }
  console.log(`  Team Members: ${team.length} inserted`);

  console.log("\nSeed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
