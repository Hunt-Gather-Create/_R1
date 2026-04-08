/**
 * Seed Runway database from static data.ts
 *
 * Usage: pnpm runway:seed
 * Requires: RUNWAY_DATABASE_URL in .env.local (or falls back to file:runway-local.db)
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { loadEnvLocal } from "./lib/load-env";

loadEnvLocal();
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

/**
 * Extract the "base name" of a title — the part before any parenthetical,
 * em dash, or special delimiter. E.g.:
 * "New Capacity (PPT, brochure, one-pager)" → "new capacity"
 * "CDS Messaging & Pillars R1" → "cds messaging & pillars r1"
 */
function baseName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s*[(\u2014—].*$/, "") // strip from first ( or em dash onwards
    .trim();
}

/**
 * Find a matching projectId for a week item by fuzzy-matching its title
 * against the client's projects.
 *
 * Match strategies (tried in order, first match wins):
 * 1. Full project name is contained in the week item title
 * 2. Week item title is contained in the full project name (min 8 chars to avoid false positives)
 * 3. Base name of the project (before parenthetical) matches the start of the week item base name
 *
 * Returns null for standalone tasks with no project match.
 */
export function findProjectIdForWeekItem(
  clientId: string,
  title: string,
  projectsByClient: Map<string, { id: string; name: string }[]>
): string | null {
  const clientProjects = projectsByClient.get(clientId);
  if (!clientProjects) return null;

  const normalizedTitle = title.toLowerCase().trim();
  const titleBase = baseName(title);

  // Try each project — longest name first to prefer more specific matches
  const sorted = [...clientProjects].sort(
    (a, b) => b.name.length - a.name.length
  );

  for (const project of sorted) {
    const normalizedName = project.name.toLowerCase().trim();

    // Strategy 1: Full project name contained in week item title
    if (normalizedTitle.includes(normalizedName)) {
      return project.id;
    }

    // Strategy 2: Week item title contained in project name (min 8 chars)
    if (normalizedTitle.length >= 8 && normalizedName.includes(normalizedTitle)) {
      return project.id;
    }

    // Strategy 3: Base name prefix match (min 8 chars to avoid "CDS" matching everything)
    const projectBase = baseName(project.name);
    if (
      projectBase.length >= 8 &&
      (titleBase.startsWith(projectBase) || projectBase.startsWith(titleBase))
    ) {
      return project.id;
    }
  }

  return null;
}

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
  const projectsByClient = new Map<string, { id: string; name: string }[]>(); // clientId -> [{id, name}]

  for (const account of accounts) {
    const clientId = clientMap.get(account.slug)!;

    for (let i = 0; i < account.items.length; i++) {
      const item = account.items[i];
      const id = generateId();
      projectMap.set(`${account.slug}:${item.title}`, id);

      // Build lookup for week item linking
      const list = projectsByClient.get(clientId) ?? [];
      list.push({ id, name: item.title });
      projectsByClient.set(clientId, list);

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
  let linkedCount = 0;
  let unlinkedCount = 0;

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

      // Try to link to a parent project
      const projectId = clientId
        ? findProjectIdForWeekItem(clientId, item.title, projectsByClient)
        : null;

      if (projectId) {
        linkedCount++;
      } else {
        unlinkedCount++;
      }

      await db.insert(weekItems).values({
        id,
        clientId,
        projectId,
        dayOfWeek,
        weekOf,
        date: dayItems.date,
        title: item.title,
        category: item.type,
        owner: item.owner ?? null,
        resources: item.resources ?? null,
        notes: item.notes ?? null,
        sortOrder: i,
      });
      weekItemCount++;
    }
  }
  console.log(`  Week Items: ${weekItemCount} inserted (${linkedCount} linked to projects, ${unlinkedCount} unlinked)`);

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
    { name: "Kathy Horn", firstName: "Kathy", slackUserId: "U11NL4SBS", title: "Co-Founder / Executive Creative Director", roleCategory: "leadership", accountsLed: ["convergix"], channelPurpose: "Creative, copy, client relationships" },
    { name: "Jason Burks", firstName: "Jason", slackUserId: "U1HH41TFX", title: "Co-Founder / Development Director", roleCategory: "leadership", accountsLed: ["tap"], channelPurpose: "Strategy, operations, account management" },
    { name: "Jill Runyon", firstName: "Jill", slackUserId: "U08TZ6ZDEUF", title: "Director of Client Experience", roleCategory: "am", accountsLed: ["beyond-petro", "bonterra", "ag1", "edf", "abm"], channelPurpose: "Beyond Petro, AM accounts" },
    { name: "Allison Shannon", firstName: "Allison", slackUserId: "U06BA311N92", title: "Strategy Director / Sr. Account Manager", roleCategory: "am", accountsLed: ["wilsonart", "dave-asprey"], channelPurpose: "Wilsonart, AM accounts" },
    { name: "Lane Jordan", firstName: "Lane", slackUserId: "U03F7MED8F8", title: "Creative Director", roleCategory: "creative", accountsLed: [], channelPurpose: "Brand, design direction" },
    { name: "Roz", firstName: "Roz", slackUserId: "", title: "Designer", roleCategory: "creative", accountsLed: [], channelPurpose: "Design execution" },
    { name: "Leslie Crosby", firstName: "Leslie", slackUserId: "U01LJGMC1GV", title: "Sr. Frontend Dev / Technical PM", roleCategory: "dev", accountsLed: [], channelPurpose: "Dev, web builds" },
    { name: "Ronan Lane", firstName: "Ronan", slackUserId: "", title: "Senior PM", roleCategory: "pm", accountsLed: ["hopdoddy", "lppc", "soundly"], channelPurpose: "Project management, status tracking" },
    { name: "Sami Blumenthal", firstName: "Sami", slackUserId: "U0AFM4FG87P", title: "Community Manager", roleCategory: "community", accountsLed: [], channelPurpose: "Community management" },
    { name: "Tim Warren", firstName: "Tim", slackUserId: "U016N17D9KR", title: "Director of AI", roleCategory: "dev", accountsLed: [], channelPurpose: "AI, development" },
    { name: "Chris", firstName: "Chris", slackUserId: "", title: "Copywriter (HDL)", roleCategory: "contractor", accountsLed: [], channelPurpose: "HDL copy" },
    { name: "Josefina", firstName: "Josefina", slackUserId: "", title: "Contractor (Soundly)", roleCategory: "contractor", accountsLed: [], channelPurpose: "Soundly contractor" },
  ];

  for (const member of team) {
    await db.insert(teamMembers).values({
      id: generateId(),
      name: member.name,
      firstName: member.firstName,
      slackUserId: member.slackUserId || undefined,
      title: member.title,
      roleCategory: member.roleCategory,
      accountsLed: JSON.stringify(member.accountsLed),
      channelPurpose: member.channelPurpose,
    });
  }
  console.log(`  Team Members: ${team.length} inserted`);

  console.log("\nSeed complete.");
}

// Only run when executed directly (not when imported by tests)
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("seed-runway.ts") || process.argv[1].endsWith("seed-runway"));

if (isDirectExecution) {
  seed().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
