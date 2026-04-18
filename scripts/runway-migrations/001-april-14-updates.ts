/**
 * Migration 001: April 14 Data Updates
 *
 * Applies ~20 queued changes: team member deactivation, client roster updates,
 * global resource swaps, specific owner reassignments, and Bonterra cleanup.
 *
 * Dry-run: reads and logs all changes without writing.
 * Apply: calls operations layer for writes with full audit trail.
 */

import type { MigrationContext } from "../runway-migrate";
import { projects, weekItems } from "@/lib/db/runway-schema";
import {
  findTeamMemberByFuzzyName,
  getClientOrFail,
  getAllClients,
  containsName,
  replaceResourceName,
  removeFromResources,
  mergeJsonArray,
} from "@/lib/runway/operations-utils";
import {
  updateTeamMember,
  updateClientField,
  updateProjectField,
  updateWeekItemField,
  deleteProject,
} from "@/lib/runway/operations";

// ── Migration Helpers ───────────────────────────────────

type OperationResult =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; error: string; available?: string[] };

/**
 * Apply a migration step: log what will happen, execute if not dry-run, log errors.
 * Returns the result or null if dry-run.
 */
async function applyStep(
  ctx: MigrationContext,
  label: string,
  fn: () => Promise<OperationResult>
): Promise<OperationResult | null> {
  ctx.log(label);
  if (ctx.dryRun) return null;
  const result = await fn();
  if (!result.ok) {
    ctx.log(`  ERROR: ${result.error}`);
  }
  return result;
}

/**
 * Apply resource swaps to owner/resources fields across a set of entities.
 * Scans each entity, applies all swaps to a running value per field, writes once if changed.
 */
async function applyResourceSwaps<T extends Record<string, unknown>>(
  ctx: MigrationContext,
  entities: T[],
  swaps: Array<{ search: string; replacement: string }>,
  config: {
    getSlug: (entity: T) => string | undefined;
    getName: (entity: T) => string;
    skipItem?: (entity: T) => boolean;
    updateFn: (entity: T, field: string, newValue: string) => Promise<OperationResult>;
  }
): Promise<void> {
  for (const entity of entities) {
    const slug = config.getSlug(entity);
    if (!slug) continue;
    if (config.skipItem?.(entity)) continue;

    for (const field of ["owner", "resources"] as const) {
      const current = entity[field] as string | null;
      if (!current) continue;

      let newValue = current;
      for (const { search, replacement } of swaps) {
        if (containsName(newValue, search)) {
          newValue = replaceResourceName(newValue, search, replacement);
        }
      }

      if (newValue !== current) {
        await applyStep(
          ctx,
          `${config.getName(entity)} (${slug}) ${field}: "${current}" → "${newValue}"`,
          () => config.updateFn(entity, field, newValue)
        );
      }
    }
  }
}

// ── Exports ──────────────────────────────────────────────

export const description =
  "April 14 data updates: team changes, resource swaps, owner reassignments, Bonterra cleanup";

export async function up(ctx: MigrationContext): Promise<void> {
  await teamMemberChanges(ctx);
  await clientTeamRoster(ctx);
  await globalResourceSwaps(ctx);
  await ownerReassignments(ctx);
  await bonterraCleanup(ctx);
  await staleItemsAudit(ctx);
}

// ── Section 4 specific titles (built first for Section 3 exclusion) ──

const SECTION_4_WEEK_ITEM_TITLES = new Set([
  "LPPC copy expected",
  "LPPC Map R2",
  "LPPC Map + Website Launch",
  "Brand Refresh Website launch",
  "Social posts reviewed at status",
  "Social Post Approval",
  "Raise stale items",
]);

function isSection4Item(title: string): boolean {
  const lower = title.toLowerCase();
  for (const s4title of SECTION_4_WEEK_ITEM_TITLES) {
    if (lower.includes(s4title.toLowerCase())) return true;
  }
  return false;
}

// ── Section 1: Team Member Changes ───────────────────────

async function teamMemberChanges(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Section 1: Team Member Changes ===");

  // 1a. Deactivate Ronan
  const ronan = await findTeamMemberByFuzzyName("Ronan");
  if (ronan) {
    ctx.log(`Ronan Lane: isActive ${ronan.isActive} → 0`);
    if (!ctx.dryRun) {
      await updateTeamMember({
        memberName: "Ronan",
        field: "isActive",
        newValue: "0",
        updatedBy: "migration",
      });
    }
  } else {
    ctx.log("WARNING: Team member 'Ronan' not found, skipping deactivation");
  }

  // 1b. Jill accountsLed: add hopdoddy, soundly
  const jill = await findTeamMemberByFuzzyName("Jill");
  if (jill) {
    const newLed = mergeJsonArray(jill.accountsLed, [
      "hopdoddy",
      "soundly",
    ]);
    ctx.log(
      `Jill accountsLed: ${jill.accountsLed ?? "[]"} → ${newLed}`
    );
    if (!ctx.dryRun) {
      await updateTeamMember({
        memberName: "Jill",
        field: "accountsLed",
        newValue: newLed,
        updatedBy: "migration",
      });
    }
  } else {
    ctx.log("WARNING: Team member 'Jill' not found, skipping accountsLed");
  }

  // 1c. Kathy accountsLed: add lppc
  const kathy = await findTeamMemberByFuzzyName("Kathy");
  if (kathy) {
    const newLed = mergeJsonArray(kathy.accountsLed, ["lppc"]);
    ctx.log(
      `Kathy accountsLed: ${kathy.accountsLed ?? "[]"} → ${newLed}`
    );
    if (!ctx.dryRun) {
      await updateTeamMember({
        memberName: "Kathy",
        field: "accountsLed",
        newValue: newLed,
        updatedBy: "migration",
      });
    }
  } else {
    ctx.log("WARNING: Team member 'Kathy' not found, skipping accountsLed");
  }
}

// ── Section 2: Client Team Roster ────────────────────────

async function clientTeamRoster(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Section 2: Client Team Roster ===");

  const rosterChanges: Array<{
    slug: string;
    newTeam: string;
  }> = [
    { slug: "convergix", newTeam: "PM: Jason" },
    { slug: "lppc", newTeam: "PM: Jason" },
    {
      slug: "beyond-petro",
      newTeam: "Kathy Horn, Jill Runyon, Jason Burks",
    },
  ];

  for (const { slug, newTeam } of rosterChanges) {
    const lookup = await getClientOrFail(slug);
    if (!lookup.ok) {
      ctx.log(`WARNING: Client '${slug}' not found, skipping team update`);
      continue;
    }
    const { client } = lookup;
    await applyStep(
      ctx,
      `${client.name} team: "${client.team ?? ""}" → "${newTeam}"`,
      () => updateClientField({ clientSlug: slug, field: "team", newValue: newTeam, updatedBy: "migration" })
    );
  }
}

// ── Section 3: Global Resource Swaps ─────────────────────

async function globalResourceSwaps(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Section 3: Global Resource Swaps ===");

  const swaps = [
    { search: "Paige", replacement: "Lane" },
    { search: "Roz", replacement: "Lane" },
    { search: "Avery", replacement: "Kathy" },
  ];

  // Build client slug lookup
  const allClients = await getAllClients();
  const clientSlugById = new Map(allClients.map((c) => [c.id, c.slug]));

  // Scan all projects — apply ALL swaps to a running value per field, write once
  const allProjects = await ctx.db.select().from(projects);
  await applyResourceSwaps(ctx, allProjects, swaps, {
    getSlug: (p) => clientSlugById.get(p.clientId),
    getName: (p) => `Project "${p.name}"`,
    updateFn: (p, field, newValue) =>
      updateProjectField({ clientSlug: clientSlugById.get(p.clientId)!, projectName: p.name, field, newValue, updatedBy: "migration" }),
  });

  // Scan all week items (skip Section 4 items) — same pattern: all swaps per field, write once
  const allWeekItems = await ctx.db.select().from(weekItems);
  await applyResourceSwaps(ctx, allWeekItems, swaps, {
    getSlug: (item) => {
      if (!item.weekOf) {
        ctx.log(`WARNING: Week item "${item.title}" has no weekOf, skipping`);
        return undefined;
      }
      return item.weekOf;
    },
    getName: (item) => `Week item "${item.title}"`,
    skipItem: (item) => isSection4Item(item.title),
    updateFn: (item, field, newValue) =>
      updateWeekItemField({ weekOf: item.weekOf!, weekItemTitle: item.title, field, newValue, updatedBy: "migration" }),
  });
}

// ── Section 4: Owner Reassignments ───────────────────────

async function ownerReassignments(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Section 4: Owner Reassignments ===");

  // 4a. Week item reassignments
  const weekItemChanges: Array<{
    titleSearch: string;
    changes: Array<{ field: string; newValue: string | null }>;
  }> = [
    {
      titleSearch: "LPPC copy expected",
      changes: [{ field: "owner", newValue: "Kathy" }],
    },
    {
      titleSearch: "LPPC Map R2",
      changes: [
        { field: "owner", newValue: "Kathy" },
        { field: "resources", newValue: "Lane" },
      ],
    },
    {
      titleSearch: "LPPC Map + Website Launch",
      changes: [{ field: "owner", newValue: "Kathy" }],
    },
    {
      titleSearch: "Brand Refresh Website launch",
      changes: [{ field: "owner", newValue: "Jill" }],
    },
    {
      titleSearch: "Social posts reviewed at status",
      changes: [
        { field: "owner", newValue: "Kathy" },
        { field: "resources", newValue: "Lane" },
      ],
    },
    {
      titleSearch: "Social Post Approval",
      changes: [], // resources: remove Ronan (computed below)
    },
    {
      titleSearch: "Raise stale items",
      changes: [], // resources: remove Ronan (computed below)
    },
  ];

  // Scan all week items once
  const allWeekItems = await ctx.db.select().from(weekItems);

  for (const { titleSearch, changes } of weekItemChanges) {
    const matches = allWeekItems.filter((item) =>
      item.title.toLowerCase().includes(titleSearch.toLowerCase())
    );

    if (matches.length === 0) {
      ctx.log(
        `WARNING: No week item matching "${titleSearch}" found, skipping`
      );
      continue;
    }
    if (matches.length > 1) {
      ctx.log(
        `WARNING: Multiple week items match "${titleSearch}": ${matches.map((m) => `"${m.title}"`).join(", ")}. Skipping to avoid wrong update.`
      );
      continue;
    }

    const item = matches[0];
    if (!item.weekOf) {
      ctx.log(
        `WARNING: Week item "${item.title}" has no weekOf, skipping`
      );
      continue;
    }

    // Handle "remove Ronan from resources" for the last two items
    let effectiveChanges = changes;
    if (changes.length === 0) {
      const newResources = removeFromResources(item.resources, "Ronan");
      effectiveChanges = [
        {
          field: "resources",
          newValue: newResources,
        },
      ];
    }

    for (const { field, newValue } of effectiveChanges) {
      const currentValue = item[field as keyof typeof item] ?? "";
      const displayNew = newValue ?? "(null)";
      ctx.log(
        `Week item "${item.title}" ${field}: "${currentValue}" → "${displayNew}"`
      );
      if (!ctx.dryRun) {
        await updateWeekItemField({
          weekOf: item.weekOf,
          weekItemTitle: item.title,
          field,
          newValue: newValue ?? "",
          updatedBy: "migration",
        });
      }
    }
  }

  // 4b. Project reassignments
  ctx.log("--- Project reassignments ---");

  const projectChanges: Array<{
    clientSlug: string;
    projectName: string;
    field: string;
    newValue: string;
  }> = [
    {
      clientSlug: "convergix",
      projectName: "Social Content (12 posts/mo)",
      field: "owner",
      newValue: "Kathy",
    },
    {
      clientSlug: "convergix",
      projectName: "Social Content (12 posts/mo)",
      field: "resources",
      newValue: "Lane",
    },
    {
      clientSlug: "soundly",
      projectName: "AARP Member Login + Landing Page",
      field: "owner",
      newValue: "Jill",
    },
    {
      clientSlug: "soundly",
      projectName: "AARP Member Login + Landing Page",
      field: "resources",
      newValue: "Josefina",
    },
    {
      clientSlug: "hopdoddy",
      projectName: "Digital Retainer",
      field: "notes",
      newValue: "Check with Jill",
    },
  ];

  for (const { clientSlug, projectName, field, newValue } of projectChanges) {
    const lookup = await getClientOrFail(clientSlug);
    if (!lookup.ok) {
      ctx.log(
        `WARNING: Client '${clientSlug}' not found, skipping project "${projectName}"`
      );
      continue;
    }

    await applyStep(
      ctx,
      `Project "${projectName}" (${clientSlug}) ${field} → "${newValue}"`,
      () => updateProjectField({ clientSlug, projectName, field, newValue, updatedBy: "migration" })
    );
  }
}

// ── Section 5: Bonterra Cleanup ──────────────────────────

async function bonterraCleanup(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Section 5: Bonterra Cleanup ===");

  // 5a. Delete Brand Refresh project
  await applyStep(
    ctx,
    "Delete project: Bonterra / Brand Refresh",
    () => deleteProject({ clientSlug: "bonterra", projectName: "Brand Refresh", updatedBy: "migration" })
  );

  // 5b. Update Impact Report notes
  const impactNotes =
    "Client was 3 weeks late on content. They picked a Design Direction and gave feedback, Lane is applying feedback, targeting going to Leslie tomorrow to K/O Dev.";
  await applyStep(
    ctx,
    `Update project: Bonterra / Impact Report notes → "${impactNotes}"`,
    () => updateProjectField({ clientSlug: "bonterra", projectName: "Impact Report", field: "notes", newValue: impactNotes, updatedBy: "migration" })
  );

  // 5c. Update Bonterra contractStatus
  await applyStep(
    ctx,
    'Update client: Bonterra contractStatus → "signed"',
    () => updateClientField({ clientSlug: "bonterra", field: "contractStatus", newValue: "signed", updatedBy: "migration" })
  );
}

// ── Section 6: Stale Items Audit (read-only) ─────────────

async function staleItemsAudit(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Section 6: Stale Items Audit (read-only) ===");

  const today = new Date().toISOString().slice(0, 10);

  const allWeekItems = await ctx.db.select().from(weekItems);
  const allClientsList = await getAllClients();
  const clientNameById = new Map(allClientsList.map((c) => [c.id, c.name]));

  // Past-due items with no status
  const staleItems = allWeekItems.filter(
    (item) => item.date && item.date < today && !item.status
  );

  if (staleItems.length === 0) {
    ctx.log("No stale items found.");
  } else {
    ctx.log(`Found ${staleItems.length} stale item(s):`);
    for (const item of staleItems) {
      const clientName = item.clientId
        ? clientNameById.get(item.clientId) ?? "Unknown"
        : "No client";
      ctx.log(
        `  - ${clientName}: "${item.title}" (date: ${item.date}, owner: ${item.owner ?? "none"})`
      );
    }
  }

  // Completed items (confirmation)
  const completedItems = allWeekItems.filter(
    (item) =>
      item.date &&
      item.date < today &&
      (item.status === "completed" || item.status === "done")
  );

  if (completedItems.length > 0) {
    ctx.log(`\n${completedItems.length} completed item(s) confirmed:`);
    for (const item of completedItems) {
      const clientName = item.clientId
        ? clientNameById.get(item.clientId) ?? "Unknown"
        : "No client";
      ctx.log(
        `  ✓ ${clientName}: "${item.title}" (date: ${item.date}, status: ${item.status})`
      );
    }
  }
}
