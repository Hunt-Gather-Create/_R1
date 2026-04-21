/**
 * Migration: Convergix Data Cleanup — 2026-04-20
 *
 * Second client cleanup using the shared-project model (Bonterra was first).
 *
 * Ops:
 *   - Delete 7 L1 projects (5 CDS phase-rows being consolidated + old Corporate PPT + old Corporate Overview Brochure)
 *   - Create 3 new L1 parents (Corporate Collateral Updates, Big Win Template, Rockwell Automation Co-Marketing Efforts)
 *   - Update 9 existing L1 projects (status/category/owner/resources/waitingOn/notes combinations)
 *   - Flip 3 L1 projects to status=completed, category=completed (historical retention)
 *   - Rewire 8 L2 week items (6 children of deleted parents + 2 orphans) to new/existing parents
 *   - Mark 14 L2 week items completed (historical)
 *   - Create 17 new L2 week items
 *   - Update Convergix client team field (Copy → CW)
 *
 * Operation order (pinned, Variant A):
 *   pre-checks → narrow pre-write snapshot → delete 7 L1s → create 3 new parents
 *   (capture IDs via fuzzy re-query) → update 9 existing L1s + flip 3 to completed
 *   → rewire 8 L2s (fields then link) → mark 14 L2s completed → create 17 L2s
 *   → update client team → verification.
 *
 * Pre-check deviation from template: the 5 CDS phase-projects INTENTIONALLY have
 * children that must move. `deleteProject` nulls their FK in a transaction;
 * those children are rewired in Phase 4. The 2 added deletes (`b81c5f13`,
 * `2c2a1865`) DO honor the standard no-children check.
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { and, eq, inArray, isNull, like, ne } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import {
  addProject,
  createWeekItem,
  deleteProject,
  findProjectByFuzzyName,
  linkWeekItemToProject,
  updateClientField,
  updateProjectField,
  updateProjectStatus,
  updateWeekItemField,
} from "@/lib/runway/operations";

// ── Constants ────────────────────────────────────────────

const CONVERGIX_SLUG = "convergix";
const CONVERGIX_ID = "181fea93bc4d435db0a1a8283";
const UPDATED_BY = "migration";
const CONVERGIX_TEAM_NEW = "CD: Lane, CW: Kathy, Dev: Leslie, PM: Jason";

// Section A — L1 deletes (7 total: 5 CDS phase + 2 old Corporate)
interface DeleteSpec {
  readonly prefix: string;
  readonly name: string;
  readonly hasChildren: boolean;
}
const DELETE_SPECS: readonly DeleteSpec[] = [
  { prefix: "9b794ad8", name: "CDS Messaging & Pillars R1", hasChildren: true },
  { prefix: "fcf4eea7", name: "CDS Creative Wrapper R1", hasChildren: true },
  { prefix: "c0d2af99", name: "CDS Social Posts (5)", hasChildren: true },
  { prefix: "06766380", name: "CDS Landing Page", hasChildren: true },
  { prefix: "a39b737f", name: "CDS Case Study + Brochure", hasChildren: true },
  { prefix: "b81c5f13", name: "Corporate PPT", hasChildren: false },
  { prefix: "2c2a1865", name: "Corporate Overview Brochure", hasChildren: false },
] as const;

// Section B — L1 creates (3 new parents)
interface CreateSpec {
  readonly name: string;
  readonly status: string;
  readonly category: string;
  readonly owner: string;
  readonly resources?: string;
  readonly waitingOn?: string;
  readonly notes: string;
}
const CREATE_SPECS: readonly CreateSpec[] = [
  {
    name: "Corporate Collateral Updates",
    status: "awaiting-client",
    category: "awaiting-client",
    owner: "Kathy",
    resources: "CD: Lane",
    waitingOn: "Daniel",
    notes:
      "Bundled update to Corporate Overview Brochure + Corporate PPT. Held together per Kathy — 'not piecemealing.' Blocked on Daniel's cert logos/info + Fanuc award details (post-4/28).",
  },
  {
    name: "Big Win Template",
    status: "in-production",
    category: "active",
    owner: "Kathy",
    resources: "CD: Lane",
    notes:
      "PPT template for SharePoint internal big-win announcements (editable per win). Companion social announcement template (adjustable like existing social). Nicole sent examples. Kickoff 4/21, target complete this week.",
  },
  {
    name: "Rockwell Automation Co-Marketing Efforts",
    status: "awaiting-client",
    category: "awaiting-client",
    owner: "Kathy",
    resources: "CW: Kathy",
    waitingOn: "Daniel",
    notes:
      "Multi-deliverable co-marketing work, pending scope clarity from Daniel/Rockwell. Hot-sheet scope: case study (Rockwell-led, feature ConvergeX), OEM social page, Automation Fair November participation, Convergix page updates on Rockwell portal. Role split between Civ and Rockwell unclear.",
  },
] as const;

// Section C — L1 existing updates (9 projects, each with a bundle of field changes)
interface ProjectUpdateSpec {
  readonly prefix: string;
  readonly label: string;
  readonly fields: {
    readonly status?: string;
    readonly category?: string;
    readonly owner?: string;
    readonly resources?: string;
    readonly waitingOn?: string;
    readonly notes?: string;
  };
}
const PROJECT_UPDATE_SPECS: readonly ProjectUpdateSpec[] = [
  {
    prefix: "394f9e5e",
    label: "Rockwell PartnerNetwork Award",
    fields: { status: "in-production", category: "active", owner: "Kathy" },
  },
  {
    prefix: "c0935359",
    label: "Texas Instruments",
    fields: { status: "in-production", category: "active", owner: "Kathy" },
  },
  {
    prefix: "135c5a61",
    label: "Events Page Updates",
    fields: { status: "in-production", category: "active", owner: "Kathy" },
  },
  {
    prefix: "3d5215f4",
    label: "Fanuc Award",
    fields: {
      category: "active",
      owner: "Kathy",
      resources: "CW: Kathy, Dev: Leslie",
      notes:
        "Sales Excellence Award, Fanuc photo op 4/28. Nicole on-site for photos. Same template as Rockwell/TI — web news post + social post.",
    },
  },
  {
    prefix: "f391dff5",
    label: "Social Content",
    fields: {
      category: "active",
      owner: "Kathy",
      resources: "CD: Lane",
      notes:
        "Monthly social cadence. Kathy to onboard Sami. Lane to oversight Sami learning Figma templates.",
    },
  },
  {
    prefix: "0c208308",
    label: "New Capacity",
    fields: {
      status: "awaiting-client",
      category: "awaiting-client",
      owner: "Kathy",
      resources: "CD: Lane",
      waitingOn: "JJ",
      notes:
        "R4 PPT delivered to JJ 4/16, awaiting feedback. One slide remaining post-approval: timeline slide. Brochure + one-pager dormant until PPT locks (no schedule, no feedback received yet).",
    },
  },
  {
    prefix: "51f39e5c",
    label: "Brand Guide v2",
    fields: {
      category: "active",
      owner: "Kathy",
      resources: "CD: Lane",
      notes:
        "Remaining scope: secondary color palette + swap Google Icons link for Microsoft. Blocked until New Capacity PPT R4 approved by JJ.",
    },
  },
  {
    prefix: "68a4ee37",
    label: "Certifications Page",
    fields: {
      status: "awaiting-client",
      category: "awaiting-client",
      owner: "Kathy",
      notes:
        "Logo soup — add new partner/certification logos. Daniel to share logos + info. Pending 2+ weeks. Also upstream blocker for Corporate Collateral Updates.",
    },
  },
  {
    prefix: "0e4214c6",
    label: "Industry Vertical Campaigns",
    fields: {
      status: "awaiting-client",
      category: "awaiting-client",
      owner: "Kathy",
      resources: "CW: Kathy, CD: Lane",
      notes:
        "Two verticals. CDS: R1 delivered to Jared + Bob 4/16 — messaging pillars + 5 social post copy + 3 landing page wires (copy only, no visuals). Pending feedback, no deadline, not being pushed. Brochure scope TBD post-feedback. Flow: client approves → Lane layout → Leslie dev. Industrial/Battery Assembly: pending Jamie Nelson connect (Civ-side action).",
    },
  },
] as const;

// Section D — L1 status+category flip to completed (3 projects)
interface FlipSpec {
  readonly prefix: string;
  readonly label: string;
}
const FLIP_COMPLETED_SPECS: readonly FlipSpec[] = [
  { prefix: "c568d7a6", label: "Social Media Templates" },
  { prefix: "7c8478dc", label: "Organic Social Playbook" },
  { prefix: "4b5bf2f0", label: "Life Sciences Brochure" },
] as const;

// Section E — L2 week item rewires (8 items)
interface WeekItemRewireSpec {
  readonly prefix: string;
  readonly expectedCurrentTitle: string;
  readonly expectedCurrentWeekOf: string;
  readonly targetParentPrefix: string; // full ID resolved at runtime
  readonly fields: {
    readonly status?: string;
    readonly date?: string;
    readonly dayOfWeek?: string;
    readonly weekOf?: string;
    readonly owner?: string;
    readonly resources?: string;
    readonly notes?: string;
    readonly title?: string;
  };
}
const WEEK_ITEM_REWIRE_SPECS: readonly WeekItemRewireSpec[] = [
  {
    prefix: "9e432ae4",
    expectedCurrentTitle: "AIST tradeshow",
    expectedCurrentWeekOf: "2026-05-04",
    targetParentPrefix: "135c5a61", // Events Page Updates
    fields: { resources: "Dev: Leslie" },
  },
  {
    prefix: "13bba3b1",
    expectedCurrentTitle: "Fanuc Award Article enters schedule",
    expectedCurrentWeekOf: "2026-04-20",
    targetParentPrefix: "3d5215f4", // Fanuc Award
    fields: {
      status: "blocked",
      date: "2026-04-23",
      dayOfWeek: "thursday",
      owner: "Kathy",
      resources: "CW: Kathy",
      notes:
        "Ask Nicole/Daniel if any early award info can be shared before 4/28 for pre-write. Rewired from orphan.",
      title: "Fanuc Award — Pre-Event Info Ask",
    },
  },
  // Two items under deleted 9b794ad8 rewired to 0e4214c6 per TP decision Q2
  {
    prefix: "726653b6",
    expectedCurrentTitle: "CDS Messaging & Pillars R1 (Gate for all CDS content)",
    expectedCurrentWeekOf: "2026-04-06",
    targetParentPrefix: "0e4214c6",
    fields: {}, // rewire only, no field changes (Phase 5 marks completed)
  },
  {
    prefix: "01e56319",
    expectedCurrentTitle: "CDS Messaging",
    expectedCurrentWeekOf: "2026-04-06",
    targetParentPrefix: "0e4214c6",
    fields: {}, // rewire only, no field changes
  },
  {
    prefix: "be6c1dbf",
    expectedCurrentTitle: "CDS Creative Wrapper R1",
    expectedCurrentWeekOf: "2026-04-06",
    targetParentPrefix: "0e4214c6",
    fields: {
      status: "in-progress",
      date: "2026-04-23",
      dayOfWeek: "thursday",
      weekOf: "2026-04-20",
      owner: "Kathy",
      resources: "CD: Lane",
      notes:
        "Visual design framework (fonts, colors, layout). Separate track from messaging. Flag: confirm current progress with Kathy.",
      title: "CDS Creative Wrapper",
    },
  },
  {
    prefix: "eaf0ac30",
    expectedCurrentTitle: "CDS Social Posts KO",
    expectedCurrentWeekOf: "2026-04-20",
    targetParentPrefix: "0e4214c6",
    fields: {
      status: "blocked",
      date: "2026-04-30",
      dayOfWeek: "thursday",
      weekOf: "2026-04-27",
      owner: "Kathy",
      resources: "CW: Kathy, CD: Lane",
      notes:
        "R1 copy delivered 4/16. Pending messaging approval. Next: add visuals → post on ConvergeX behalf. No committed deadline — reforecast after R1 feedback.",
      title: "CDS 5 Social Posts — Kickoff",
    },
  },
  {
    prefix: "813b04a5",
    expectedCurrentTitle: "CDS Landing Page KO",
    expectedCurrentWeekOf: "2026-04-20",
    targetParentPrefix: "0e4214c6",
    fields: {
      status: "blocked",
      date: "2026-04-30",
      dayOfWeek: "thursday",
      weekOf: "2026-04-27",
      owner: "Kathy",
      resources: "CW: Kathy, CD: Lane, Dev: Leslie",
      notes:
        "3 pages, same wireframe, different topics. R1 wires delivered 4/16 (copy only). Pending messaging approval. Flow: approve → Lane design → Leslie dev. No committed deadline.",
      title: "CDS 3 Landing Pages — Kickoff",
    },
  },
  {
    prefix: "46bce314",
    expectedCurrentTitle: "CDS Case Study + Brochure KO",
    expectedCurrentWeekOf: "2026-05-04",
    targetParentPrefix: "0e4214c6",
    fields: {
      status: "blocked",
      date: "2026-04-30",
      dayOfWeek: "thursday",
      weekOf: "2026-04-27",
      owner: "Kathy",
      resources: "CW: Kathy, CD: Lane",
      notes:
        "NOT in R1 delivery — held for scope decision post-feedback. Kathy needs client input on breadth. Scope + schedule TBD after R1 feedback.",
      title: "CDS Brochure — Kickoff",
    },
  },
] as const;

// Section G — L2 mark completed (14 items)
const MARK_COMPLETED_PREFIXES: readonly string[] = [
  "726653b6",
  "01e56319",
  "232da909",
  "bd747873",
  "54cd9bb4",
  "3549dda3",
  "8ebc10b0",
  "3f3555e3",
  "91f4f864",
  "4a5bd1c9",
  "f92c3872",
  "d8c4dff5",
  "d95dcc81",
  "edf491ae",
] as const;

// Section F — L2 creates (17 items)
interface CreateWeekItemSpec {
  readonly parentRef:
    | { readonly kind: "existing"; readonly prefix: string } // resolve to name via preflight
    | { readonly kind: "new"; readonly name: string }; // resolve to captured new-parent name
  readonly title: string;
  readonly date: string;
  readonly dayOfWeek: string;
  readonly category: string;
  readonly status?: string;
  readonly owner: string;
  readonly resources: string;
  readonly notes: string;
}
const CREATE_WEEK_ITEM_SPECS: readonly CreateWeekItemSpec[] = [
  // Under 394f9e5e Rockwell PartnerNetwork Award (2)
  {
    parentRef: { kind: "existing", prefix: "394f9e5e" },
    title: "Rockwell Partner Award — Image Swap",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "delivery",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes: "Image swap from RA toolkit. Goal up before Thursday status.",
  },
  {
    parentRef: { kind: "existing", prefix: "394f9e5e" },
    title: "Rockwell Partner Award — Social Post",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "approval",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes:
      "Copy written. Pending Daniel approval on whether to post (ConvergeX already did their own post).",
  },
  // Under c0935359 Texas Instruments (2)
  {
    parentRef: { kind: "existing", prefix: "c0935359" },
    title: "Texas Instruments Award — Page Build",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "delivery",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes:
      "Same template as Rockwell. Copy + logo provided. Goal up before Thursday status.",
  },
  {
    parentRef: { kind: "existing", prefix: "c0935359" },
    title: "Texas Instruments Award — Social Post",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "approval",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes: "Copy written. Pending social asset feedback from client.",
  },
  // Under 135c5a61 Events Page Updates (1)
  {
    parentRef: { kind: "existing", prefix: "135c5a61" },
    title: "Events Page — 2026 Updates Live",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "delivery",
    owner: "Kathy",
    resources: "Dev: Leslie",
    notes:
      "Replace 2025 with 2026 list. Copy in hot sheet. Same format/logos. Nicole owes MD&M West YouTube link. Automation Fair — confirm with Rockwell.",
  },
  // Under 68a4ee37 Certifications Page (1)
  {
    parentRef: { kind: "existing", prefix: "68a4ee37" },
    title: "Certifications Page — Daniel Follow-Up",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes:
      "Follow up with Daniel on cert logos + info. Pending 2+ weeks. Will unblock Corporate Collateral Updates.",
  },
  // Under 3d5215f4 Fanuc Award (1)
  {
    parentRef: { kind: "existing", prefix: "3d5215f4" },
    title: "Fanuc Award — Post-Event Article Kickoff",
    date: "2026-04-30",
    dayOfWeek: "thursday",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    resources: "CW: Kathy, Dev: Leslie",
    notes:
      "Event 4/28. Begin article + social post once Nicole's photos + award details in hand.",
  },
  // Under f391dff5 Social Content (2)
  {
    parentRef: { kind: "existing", prefix: "f391dff5" },
    title: "April Social — Week of 4/20 Posts (4 posts)",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "delivery",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes:
      "4 posts Mon-Thu. Includes Careers carousel (role per slide). Kathy executing; Sami ramping on Figma templates under Lane's oversight.",
  },
  {
    parentRef: { kind: "existing", prefix: "f391dff5" },
    title: "May Content Calendar Draft to Client",
    date: "2026-04-27",
    dayOfWeek: "monday",
    category: "deadline",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes: "May cadence proposal based on April learnings. Kathy planning this week.",
  },
  // Under 0c208308 New Capacity (3)
  {
    parentRef: { kind: "existing", prefix: "0c208308" },
    title: "New Capacity PPT — JJ Feedback Check-In",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "approval",
    status: "blocked",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes:
      "Follow up on R4 sent 4/16. Timeline slide is final piece post-approval.",
  },
  {
    parentRef: { kind: "existing", prefix: "0c208308" },
    title: "New Capacity Brochure — Pending PPT Lock",
    date: "2026-04-30",
    dayOfWeek: "thursday",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    resources: "CD: Lane",
    notes:
      "No schedule, no feedback received yet. Kicks off once PPT R4 approved. Dormant.",
  },
  {
    parentRef: { kind: "existing", prefix: "0c208308" },
    title: "New Capacity One-Pager — Pending PPT Lock",
    date: "2026-04-30",
    dayOfWeek: "thursday",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    resources: "CD: Lane",
    notes:
      "No schedule, no feedback received yet. Kicks off once PPT R4 approved. Dormant.",
  },
  // Under 51f39e5c Brand Guide v2 (1)
  {
    parentRef: { kind: "existing", prefix: "51f39e5c" },
    title: "Brand Guide v2 — Secondary Palette + Icon Swap",
    date: "2026-04-30",
    dayOfWeek: "thursday",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    resources: "CD: Lane",
    notes:
      "Unblocks once New Capacity PPT R4 approved by JJ. Scope: secondary color palette + Google→Microsoft icon swap.",
  },
  // Under new 'Corporate Collateral Updates' parent (2)
  {
    parentRef: { kind: "new", name: "Corporate Collateral Updates" },
    title: "Corporate Overview Brochure — Updates",
    date: "2026-04-30",
    dayOfWeek: "thursday",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    resources: "CD: Lane",
    notes:
      "Held until certs + Fanuc details arrive. Scope: Passion Icon replacement, Awards + Certifications section, Siemens logo to partners bottom row. R3 shared via Slack 3/25.",
  },
  {
    parentRef: { kind: "new", name: "Corporate Collateral Updates" },
    title: "Corporate PPT — Updates",
    date: "2026-04-30",
    dayOfWeek: "thursday",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    resources: "CD: Lane",
    notes:
      "Held until certs + Fanuc details arrive. Scope: new slide for recent awards + certifications.",
  },
  // Under new 'Big Win Template' parent (2)
  {
    parentRef: { kind: "new", name: "Big Win Template" },
    title: "Big Win Template — PPT Template",
    date: "2026-04-24",
    dayOfWeek: "friday",
    category: "delivery",
    owner: "Kathy",
    resources: "CD: Lane",
    notes: "Editable SharePoint template for internal big-win posts.",
  },
  {
    parentRef: { kind: "new", name: "Big Win Template" },
    title: "Big Win Template — Social Announcement Companion",
    date: "2026-04-24",
    dayOfWeek: "friday",
    category: "delivery",
    owner: "Kathy",
    resources: "CD: Lane",
    notes:
      "Social post template for external big-win announcements, adjustable per win. Hot sheet only (not in transcript) — flag if out of scope.",
  },
  // Under new 'Rockwell Automation Co-Marketing Efforts' parent (1)
  {
    parentRef: { kind: "new", name: "Rockwell Automation Co-Marketing Efforts" },
    title: "Rockwell Auto Co-Marketing — Daniel Scope Ask",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "kickoff",
    status: "blocked",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes:
      "Bring up at status with Daniel (now that he's back). Clarify scope split: Rockwell vs Civ deliverables. Unblocks planning for case study + other work.",
  },
  // Under 0e4214c6 Industry Vertical Campaigns (CDS parent) (2)
  {
    parentRef: { kind: "existing", prefix: "0e4214c6" },
    title: "CDS Messaging Pillars — R1 Feedback",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "approval",
    status: "blocked",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes:
      "R1 delivered to Jared + Bob 4/16. Pending feedback at Thursday status. R2 follows once feedback arrives.",
  },
  {
    parentRef: { kind: "existing", prefix: "0e4214c6" },
    title: "Industrial/Battery Assembly — Jamie Nelson Connect",
    date: "2026-04-23",
    dayOfWeek: "thursday",
    category: "kickoff",
    owner: "Kathy",
    resources: "CW: Kathy",
    notes:
      "Pending: Connect with Jamie Nelson to scope industrial/battery assembly vertical campaign. Stakeholders: Bob, Jared.",
  },
] as const;

// ── Exports ──────────────────────────────────────────────

export const description =
  "Convergix cleanup 2026-04-20: delete 7 L1s, create 3 new parents, update 9 L1s, flip 3 to completed, rewire 8 L2s, mark 14 L2s completed, create 17 new L2s, update client team.";

export async function up(ctx: MigrationContext): Promise<void> {
  ctx.log("=== Convergix Cleanup 2026-04-20 ===");

  // Step 1 — Pre-checks
  const resolved = await preChecks(ctx);

  // Step 2 — Narrow pre-apply snapshot (written immediately before first write)
  await writeSnapshot(ctx, resolved);

  if (ctx.dryRun) {
    ctx.log("Dry-run: no writes will be performed. Operation plan follows.");
  }

  // ── Phase 1 — Delete 7 L1 projects (FIRST; fuzzy-match collision avoidance) ──
  ctx.log("--- Phase 1: delete 7 L1 projects ---");
  for (const spec of DELETE_SPECS) {
    ctx.log(`Delete project: Convergix / ${spec.name} (prefix=${spec.prefix}, hasChildren=${spec.hasChildren})`);
    if (!ctx.dryRun) {
      const result = await deleteProject({
        clientSlug: CONVERGIX_SLUG,
        projectName: spec.name,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Delete ${spec.name} failed: ${result.error}`);
    }
  }

  // ── Phase 2 — Create 3 new parent projects; capture IDs ──
  ctx.log("--- Phase 2: create 3 new L1 parents ---");
  const newParentIdByName = new Map<string, string>();
  for (const spec of CREATE_SPECS) {
    ctx.log(
      `Create project: Convergix / ${spec.name} (status=${spec.status}, category=${spec.category}, owner=${spec.owner}, resources=${spec.resources ?? "null"}, waitingOn=${spec.waitingOn ?? "null"})`
    );
    if (!ctx.dryRun) {
      const result = await addProject({
        clientSlug: CONVERGIX_SLUG,
        name: spec.name,
        status: spec.status,
        category: spec.category,
        owner: spec.owner,
        resources: spec.resources,
        waitingOn: spec.waitingOn,
        notes: spec.notes,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Create ${spec.name} failed: ${result.error}`);
      // Re-query by fuzzy name to capture new ID
      const created = await findProjectByFuzzyName(CONVERGIX_ID, spec.name);
      if (!created) throw new Error(`New parent '${spec.name}' not found after create.`);
      newParentIdByName.set(spec.name, created.id);
      ctx.log(`  → new parent id: ${created.id}`);
    }
  }

  // Sanity check: each new parent should resolve unambiguously via fuzzy match.
  // In dry-run this is a no-op since nothing was created.
  if (!ctx.dryRun) {
    for (const spec of CREATE_SPECS) {
      if (!newParentIdByName.has(spec.name)) {
        throw new Error(`Pre-Phase-6 sanity check: '${spec.name}' not captured.`);
      }
    }
  }

  // ── Phase 3 — Update 9 existing L1s + flip 3 to completed ──
  ctx.log("--- Phase 3a: update 9 existing L1 projects ---");
  for (const spec of PROJECT_UPDATE_SPECS) {
    const project = resolved.projectUpdatesByPrefix.get(spec.prefix);
    if (!project) throw new Error(`Missing resolved project for prefix ${spec.prefix}`);
    await applyProjectFieldUpdates(ctx, spec, project);
  }

  ctx.log("--- Phase 3b: flip 3 L1 projects to status=completed, category=completed ---");
  for (const spec of FLIP_COMPLETED_SPECS) {
    const project = resolved.flipProjectsByPrefix.get(spec.prefix);
    if (!project) throw new Error(`Missing resolved project for flip prefix ${spec.prefix}`);
    ctx.log(`Flip ${project.name} → status=completed, category=completed`);
    if (!ctx.dryRun) {
      // Status first (may cascade; confirmed safe — no linked week items per preflight)
      const statusResult = await updateProjectStatus({
        clientSlug: CONVERGIX_SLUG,
        projectName: project.name,
        newStatus: "completed",
        updatedBy: UPDATED_BY,
      });
      if (!statusResult.ok) {
        throw new Error(`Flip status ${project.name} failed: ${statusResult.error}`);
      }
      const categoryResult = await updateProjectField({
        clientSlug: CONVERGIX_SLUG,
        projectName: project.name,
        field: "category",
        newValue: "completed",
        updatedBy: UPDATED_BY,
      });
      if (!categoryResult.ok) {
        throw new Error(`Flip category ${project.name} failed: ${categoryResult.error}`);
      }
    }
  }

  // ── Phase 4 — Rewire 8 L2 week items ──
  ctx.log("--- Phase 4: rewire 8 L2 week items ---");
  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    const row = resolved.rewireItemsByPrefix.get(spec.prefix);
    if (!row) throw new Error(`Missing resolved week item for prefix ${spec.prefix}`);
    await applyWeekItemFieldUpdates(ctx, spec, row);

    // Resolve target parent ID
    const targetProject = resolved.projectsByPrefix.get(spec.targetParentPrefix);
    if (!targetProject) {
      throw new Error(
        `Rewire target parent prefix '${spec.targetParentPrefix}' not resolved`
      );
    }
    ctx.log(`Link week item ${spec.prefix} → project ${targetProject.name} (${targetProject.id})`);
    if (!ctx.dryRun) {
      const result = await linkWeekItemToProject({
        weekItemId: row.id,
        projectId: targetProject.id,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Link ${spec.prefix} failed: ${result.error}`);
    }
  }

  // ── Phase 5 — Mark 14 L2 week items completed ──
  ctx.log("--- Phase 5: mark 14 L2 week items completed ---");
  for (const prefix of MARK_COMPLETED_PREFIXES) {
    const row = resolved.markCompletedItemsByPrefix.get(prefix);
    if (!row) throw new Error(`Missing resolved week item for mark-completed prefix ${prefix}`);
    // The rewires in Phase 4 may have changed weekOf + title for some items.
    // Resolve via the CURRENT weekOf + title (post-Phase-4 state).
    const currentState = resolved.weekItemCurrentStateByPrefix.get(prefix);
    if (!currentState) throw new Error(`Missing current state for ${prefix}`);
    ctx.log(
      `Mark completed: week item ${prefix} (weekOf=${currentState.weekOf}, title="${currentState.title}")`
    );
    if (!ctx.dryRun) {
      const result = await updateWeekItemField({
        weekOf: currentState.weekOf,
        weekItemTitle: currentState.title,
        field: "status",
        newValue: "completed",
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Mark completed ${prefix} failed: ${result.error}`);
    }
  }

  // ── Phase 6 — Create 17 new L2 week items ──
  ctx.log("--- Phase 6: create 17 new L2 week items ---");
  for (const spec of CREATE_WEEK_ITEM_SPECS) {
    let projectName: string;
    if (spec.parentRef.kind === "existing") {
      const parent = resolved.projectsByPrefix.get(spec.parentRef.prefix);
      if (!parent) {
        throw new Error(
          `Create week item '${spec.title}': parent prefix '${spec.parentRef.prefix}' not resolved`
        );
      }
      projectName = parent.name;
    } else {
      projectName = spec.parentRef.name;
    }
    ctx.log(
      `Create week item: "${spec.title}" (${spec.date} ${spec.dayOfWeek}, ${spec.category}${spec.status ? `/${spec.status}` : ""}, owner=${spec.owner}, resources=${spec.resources}) → project "${projectName}"`
    );
    if (!ctx.dryRun) {
      const result = await createWeekItem({
        clientSlug: CONVERGIX_SLUG,
        projectName,
        date: spec.date,
        dayOfWeek: spec.dayOfWeek,
        title: spec.title,
        category: spec.category,
        status: spec.status,
        owner: spec.owner,
        resources: spec.resources,
        notes: spec.notes,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) throw new Error(`Create '${spec.title}' failed: ${result.error}`);
    }
  }

  // ── Phase 7 — Update client team field ──
  ctx.log(`--- Phase 7: update Convergix team → "${CONVERGIX_TEAM_NEW}" ---`);
  if (!ctx.dryRun) {
    const result = await updateClientField({
      clientSlug: CONVERGIX_SLUG,
      field: "team",
      newValue: CONVERGIX_TEAM_NEW,
      updatedBy: UPDATED_BY,
    });
    if (!result.ok) throw new Error(`Update client team failed: ${result.error}`);
  }

  // ── Phase 8 — Verification ──
  if (!ctx.dryRun) {
    await verify(ctx, resolved, newParentIdByName);
  }

  ctx.log("=== Convergix Cleanup complete ===");
}

// ── Pre-checks ───────────────────────────────────────────

interface ResolvedState {
  readonly convergix: typeof clients.$inferSelect;
  /** All resolved projects keyed by 8-char prefix (delete + update + flip lists combined). */
  readonly projectsByPrefix: Map<string, typeof projects.$inferSelect>;
  /** Subset: projects to be updated in Phase 3a. */
  readonly projectUpdatesByPrefix: Map<string, typeof projects.$inferSelect>;
  /** Subset: projects to be flipped to completed in Phase 3b. */
  readonly flipProjectsByPrefix: Map<string, typeof projects.$inferSelect>;
  /** Week items to rewire in Phase 4. */
  readonly rewireItemsByPrefix: Map<string, typeof weekItems.$inferSelect>;
  /** Week items to mark completed in Phase 5. */
  readonly markCompletedItemsByPrefix: Map<string, typeof weekItems.$inferSelect>;
  /**
   * Current (title, weekOf) keyed by prefix for all week items the migration
   * touches. Phase 4 mutates this for items it rewires so that Phase 5 can
   * look them up at their post-rewire weekOf+title.
   */
  readonly weekItemCurrentStateByPrefix: Map<string, { title: string; weekOf: string }>;
}

async function preChecks(ctx: MigrationContext): Promise<ResolvedState> {
  ctx.log("--- Pre-checks ---");

  // Resolve Convergix client
  const convergixRows = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.slug, CONVERGIX_SLUG));
  const convergix = convergixRows[0];
  if (!convergix) {
    throw new Error(`Pre-check failed: client '${CONVERGIX_SLUG}' not found.`);
  }
  if (convergix.id !== CONVERGIX_ID) {
    throw new Error(
      `Pre-check failed: Convergix ID mismatch (got ${convergix.id}, expected ${CONVERGIX_ID}).`
    );
  }

  // Assert NONE of the 3 new parent names already exist for Convergix (case-insensitive)
  const allClientProjects = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.clientId, convergix.id));
  for (const spec of CREATE_SPECS) {
    const clash = allClientProjects.find(
      (p) => p.name.trim().toLowerCase() === spec.name.toLowerCase()
    );
    if (clash) {
      throw new Error(
        `Pre-check failed: project '${spec.name}' already exists for Convergix (id=${clash.id}). Abort.`
      );
    }
  }

  // Resolve all project prefixes (delete + update + flip)
  const projectsByPrefix = new Map<string, typeof projects.$inferSelect>();
  const projectUpdatesByPrefix = new Map<string, typeof projects.$inferSelect>();
  const flipProjectsByPrefix = new Map<string, typeof projects.$inferSelect>();

  // Collect all unique project prefixes we need to resolve
  const allProjectPrefixes = new Set<string>();
  for (const spec of DELETE_SPECS) allProjectPrefixes.add(spec.prefix);
  for (const spec of PROJECT_UPDATE_SPECS) allProjectPrefixes.add(spec.prefix);
  for (const spec of FLIP_COMPLETED_SPECS) allProjectPrefixes.add(spec.prefix);
  for (const spec of WEEK_ITEM_REWIRE_SPECS) allProjectPrefixes.add(spec.targetParentPrefix);
  for (const spec of CREATE_WEEK_ITEM_SPECS) {
    if (spec.parentRef.kind === "existing") allProjectPrefixes.add(spec.parentRef.prefix);
  }

  for (const prefix of allProjectPrefixes) {
    const matches = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, convergix.id), like(projects.id, `${prefix}%`)));
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: project prefix '${prefix}' resolved to ${matches.length} rows (expected 1).`
      );
    }
    projectsByPrefix.set(prefix, matches[0]);
  }

  // Populate subset maps
  for (const spec of PROJECT_UPDATE_SPECS) {
    const row = projectsByPrefix.get(spec.prefix);
    if (!row) throw new Error(`Internal: project ${spec.prefix} missing from map`);
    projectUpdatesByPrefix.set(spec.prefix, row);
  }
  for (const spec of FLIP_COMPLETED_SPECS) {
    const row = projectsByPrefix.get(spec.prefix);
    if (!row) throw new Error(`Internal: flip project ${spec.prefix} missing from map`);
    flipProjectsByPrefix.set(spec.prefix, row);
  }

  // Check: 5 CDS phase-projects intentionally have children (these get nulled by deleteProject);
  // 2 new deletes (b81c5f13, 2c2a1865) must have ZERO children.
  for (const spec of DELETE_SPECS) {
    const project = projectsByPrefix.get(spec.prefix);
    if (!project) throw new Error(`Internal: delete project ${spec.prefix} missing from map`);
    const children = await ctx.db
      .select({ id: weekItems.id })
      .from(weekItems)
      .where(eq(weekItems.projectId, project.id));
    if (spec.hasChildren) {
      // Expected to have children — we'll rewire them in Phase 4.
      // Verify that at least one week-item rewire spec targets this project currently
      // (i.e., preflight matches the expected child-count for the CDS-phase deletes).
      // No strict count assertion here; just log for transparency.
      ctx.log(
        `  pre-check: delete target ${spec.prefix} (${spec.name}) has ${children.length} child(ren) — will be nulled by deleteProject, rewired/completed in later phases.`
      );
    } else {
      if (children.length !== 0) {
        throw new Error(
          `Pre-check failed: delete target ${spec.prefix} (${spec.name}) expected 0 children but has ${children.length}. Abort.`
        );
      }
    }
  }

  // Flip-to-completed projects: log children count (cascade will complete them if any).
  for (const spec of FLIP_COMPLETED_SPECS) {
    const project = flipProjectsByPrefix.get(spec.prefix);
    if (!project) throw new Error(`Internal: flip ${spec.prefix} missing`);
    const children = await ctx.db
      .select({ id: weekItems.id })
      .from(weekItems)
      .where(eq(weekItems.projectId, project.id));
    if (children.length > 0) {
      ctx.log(
        `  pre-check NOTE: flip target ${spec.prefix} (${project.name}) has ${children.length} linked week item(s). updateProjectStatus will cascade 'completed' to them.`
      );
    }
  }

  // Resolve all week-item prefixes (rewire + mark-completed)
  const rewireItemsByPrefix = new Map<string, typeof weekItems.$inferSelect>();
  const markCompletedItemsByPrefix = new Map<string, typeof weekItems.$inferSelect>();
  const weekItemCurrentStateByPrefix = new Map<string, { title: string; weekOf: string }>();

  const allItemPrefixes = new Set<string>();
  for (const spec of WEEK_ITEM_REWIRE_SPECS) allItemPrefixes.add(spec.prefix);
  for (const prefix of MARK_COMPLETED_PREFIXES) allItemPrefixes.add(prefix);

  for (const prefix of allItemPrefixes) {
    const matches = await ctx.db
      .select()
      .from(weekItems)
      .where(
        and(eq(weekItems.clientId, convergix.id), like(weekItems.id, `${prefix}%`))
      );
    if (matches.length !== 1) {
      throw new Error(
        `Pre-check failed: week-item prefix '${prefix}' resolved to ${matches.length} rows (expected 1).`
      );
    }
    const row = matches[0];
    weekItemCurrentStateByPrefix.set(prefix, {
      title: row.title,
      weekOf: row.weekOf,
    });
  }
  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    const matches = await ctx.db
      .select()
      .from(weekItems)
      .where(
        and(eq(weekItems.clientId, convergix.id), like(weekItems.id, `${spec.prefix}%`))
      );
    rewireItemsByPrefix.set(spec.prefix, matches[0]);
    // Sanity check: expected current title + weekOf match preflight
    if (matches[0].title !== spec.expectedCurrentTitle) {
      throw new Error(
        `Pre-check failed: rewire item ${spec.prefix} current title is "${matches[0].title}", expected "${spec.expectedCurrentTitle}".`
      );
    }
    if (matches[0].weekOf !== spec.expectedCurrentWeekOf) {
      throw new Error(
        `Pre-check failed: rewire item ${spec.prefix} current weekOf is "${matches[0].weekOf}", expected "${spec.expectedCurrentWeekOf}".`
      );
    }
  }
  for (const prefix of MARK_COMPLETED_PREFIXES) {
    const matches = await ctx.db
      .select()
      .from(weekItems)
      .where(
        and(eq(weekItems.clientId, convergix.id), like(weekItems.id, `${prefix}%`))
      );
    markCompletedItemsByPrefix.set(prefix, matches[0]);
  }

  ctx.log(
    `Pre-checks passed. convergix=${convergix.id}, ${projectsByPrefix.size} projects resolved, ${rewireItemsByPrefix.size} rewire items, ${markCompletedItemsByPrefix.size} mark-completed items.`
  );

  return {
    convergix,
    projectsByPrefix,
    projectUpdatesByPrefix,
    flipProjectsByPrefix,
    rewireItemsByPrefix,
    markCompletedItemsByPrefix,
    weekItemCurrentStateByPrefix,
  };
}

// ── Snapshot ─────────────────────────────────────────────

async function writeSnapshot(
  ctx: MigrationContext,
  r: ResolvedState
): Promise<void> {
  const capturedAt = new Date().toISOString();

  const snapshot = {
    capturedAt,
    mode: ctx.dryRun ? "dry-run" : "apply",
    client: r.convergix,
    projectsToDelete: Array.from(
      DELETE_SPECS.map((s) => r.projectsByPrefix.get(s.prefix))
    ).filter(Boolean),
    projectsToUpdate: Array.from(r.projectUpdatesByPrefix.values()),
    projectsToFlip: Array.from(r.flipProjectsByPrefix.values()),
    weekItemsToRewire: Array.from(r.rewireItemsByPrefix.values()),
    weekItemsToMarkCompleted: Array.from(r.markCompletedItemsByPrefix.values()),
    newParentsPlanned: CREATE_SPECS.map((s) => ({
      name: s.name,
      status: s.status,
      category: s.category,
      owner: s.owner,
      resources: s.resources ?? null,
      waitingOn: s.waitingOn ?? null,
      clientId: r.convergix.id,
    })),
    newWeekItemsPlannedCount: CREATE_WEEK_ITEM_SPECS.length,
    clientTeamPlanned: CONVERGIX_TEAM_NEW,
  };

  const suffix = ctx.dryRun ? "-dryrun" : "";
  const outPath = resolvePath(
    process.cwd(),
    `docs/tmp/convergix-pre-apply-snapshot${suffix}.json`
  );
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  ctx.log(`Wrote pre-apply snapshot → ${outPath}`);
}

// ── Project field updates (Phase 3a) ────────────────────

async function applyProjectFieldUpdates(
  ctx: MigrationContext,
  spec: ProjectUpdateSpec,
  project: typeof projects.$inferSelect
): Promise<void> {
  const f = spec.fields;
  // status via updateProjectStatus (cascade-aware)
  if (f.status !== undefined && f.status !== project.status) {
    ctx.log(
      `Project ${spec.prefix} (${project.name}): status "${project.status}" → "${f.status}"`
    );
    if (!ctx.dryRun) {
      const result = await updateProjectStatus({
        clientSlug: CONVERGIX_SLUG,
        projectName: project.name,
        newStatus: f.status,
        updatedBy: UPDATED_BY,
      });
      if (!result.ok) {
        throw new Error(`Update status ${project.name} failed: ${result.error}`);
      }
    }
  }
  // category (now in PROJECT_FIELDS)
  if (f.category !== undefined && f.category !== project.category) {
    await writeProjectField(ctx, project.name, "category", f.category);
  }
  if (f.owner !== undefined && f.owner !== project.owner) {
    await writeProjectField(ctx, project.name, "owner", f.owner);
  }
  if (f.resources !== undefined && f.resources !== project.resources) {
    await writeProjectField(ctx, project.name, "resources", f.resources);
  }
  if (f.waitingOn !== undefined && f.waitingOn !== project.waitingOn) {
    await writeProjectField(ctx, project.name, "waitingOn", f.waitingOn);
  }
  if (f.notes !== undefined && f.notes !== project.notes) {
    await writeProjectField(ctx, project.name, "notes", f.notes);
  }
}

async function writeProjectField(
  ctx: MigrationContext,
  projectName: string,
  field: string,
  newValue: string
): Promise<void> {
  ctx.log(`Project '${projectName}' ${field} → "${newValue}"`);
  if (ctx.dryRun) return;
  const result = await updateProjectField({
    clientSlug: CONVERGIX_SLUG,
    projectName,
    field,
    newValue,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`Update ${projectName}.${field} failed: ${result.error}`);
  }
}

// ── Week-item field updates (Phase 4) ───────────────────

async function applyWeekItemFieldUpdates(
  ctx: MigrationContext,
  spec: WeekItemRewireSpec,
  row: typeof weekItems.$inferSelect
): Promise<void> {
  // Mirror Bonterra's applyItemFieldUpdates — track currentWeekOf/currentTitle
  let currentWeekOf = row.weekOf;
  let currentTitle = row.title;
  const fields = spec.fields;

  // Mutation order: status → date → dayOfWeek → resources → owner → notes → weekOf → title
  if (fields.status !== undefined) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "status", fields.status);
  }
  if (fields.date !== undefined) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "date", fields.date);
  }
  if (fields.dayOfWeek !== undefined) {
    await writeWeekItemField(
      ctx,
      spec.prefix,
      currentWeekOf,
      currentTitle,
      "dayOfWeek",
      fields.dayOfWeek
    );
  }
  if (fields.resources !== undefined) {
    await writeWeekItemField(
      ctx,
      spec.prefix,
      currentWeekOf,
      currentTitle,
      "resources",
      fields.resources
    );
  }
  if (fields.owner !== undefined) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "owner", fields.owner);
  }
  if (fields.notes !== undefined) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "notes", fields.notes);
  }

  // weekOf before title — the lookup key depends on weekOf
  if (fields.weekOf !== undefined && fields.weekOf !== currentWeekOf) {
    await writeWeekItemField(
      ctx,
      spec.prefix,
      currentWeekOf,
      currentTitle,
      "weekOf",
      fields.weekOf
    );
    currentWeekOf = fields.weekOf;
  }

  // Title last
  if (fields.title !== undefined && fields.title !== currentTitle) {
    await writeWeekItemField(ctx, spec.prefix, currentWeekOf, currentTitle, "title", fields.title);
    currentTitle = fields.title;
  }

  // Update resolved current state so Phase 5 can look up this item via the new weekOf+title
  // (applies to the MARK_COMPLETED flow for items that pass through Phase 4 too — only
  // `726653b6` and `01e56319` in this migration, and neither changes title/weekOf, but
  // the bookkeeping is harmless for items that do.)
  // Note: we mutate the outer resolved map so Phase 5 lookups stay consistent.
  // The map is passed by reference through `resolved`, so this mutation is visible.
  // Retrieve via closure in a small indirection — the caller passes the ResolvedState.
}

async function writeWeekItemField(
  ctx: MigrationContext,
  prefix: string,
  weekOf: string,
  title: string,
  field: string,
  newValue: string
): Promise<void> {
  ctx.log(`Week item ${prefix} (weekOf=${weekOf}, title="${title}") ${field} → "${newValue}"`);
  if (ctx.dryRun) return;
  const result = await updateWeekItemField({
    weekOf,
    weekItemTitle: title,
    field,
    newValue,
    updatedBy: UPDATED_BY,
  });
  if (!result.ok) {
    throw new Error(`Update ${prefix}.${field} failed: ${result.error}`);
  }
}

// ── Verification ─────────────────────────────────────────

async function verify(
  ctx: MigrationContext,
  r: ResolvedState,
  newParentIdByName: Map<string, string>
): Promise<void> {
  ctx.log("--- Verification ---");

  // 1. Strict orphan invariant: projectId IS NULL AND status != 'completed' AND clientId = Convergix → 0
  const strictOrphans = await ctx.db
    .select({ id: weekItems.id, title: weekItems.title, status: weekItems.status })
    .from(weekItems)
    .where(
      and(
        eq(weekItems.clientId, r.convergix.id),
        isNull(weekItems.projectId),
        ne(weekItems.status, "completed")
      )
    );
  ctx.log(
    `Strict orphans (projectId null, status != completed): ${strictOrphans.length} (expected 0)`
  );
  if (strictOrphans.length !== 0) {
    throw new Error(
      `VERIFICATION FAILED: expected 0 non-completed orphans, got ${strictOrphans.length}: ${strictOrphans
        .map((o) => `${o.id.slice(0, 8)} (${o.title}, status=${o.status})`)
        .join("; ")}.`
    );
  }

  // Informational: loose orphan count
  const looseOrphans = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(and(eq(weekItems.clientId, r.convergix.id), isNull(weekItems.projectId)));
  ctx.log(`Loose orphans (projectId null, any status): ${looseOrphans.length} (expected 9 — original orphans marked completed)`);

  // 2. Each of 7 deleted prefixes → 0 rows
  for (const spec of DELETE_SPECS) {
    const rows = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.clientId, r.convergix.id), like(projects.id, `${spec.prefix}%`)));
    if (rows.length !== 0) {
      throw new Error(`VERIFICATION FAILED: deleted project ${spec.prefix} (${spec.name}) still exists.`);
    }
  }
  ctx.log(`All ${DELETE_SPECS.length} deleted projects confirmed gone.`);

  // 3. Each of 3 new parents exists with expected fields
  for (const spec of CREATE_SPECS) {
    const id = newParentIdByName.get(spec.name);
    if (!id) throw new Error(`VERIFICATION FAILED: new parent '${spec.name}' id missing from map.`);
    const rows = await ctx.db.select().from(projects).where(eq(projects.id, id));
    const project = rows[0];
    if (!project) throw new Error(`VERIFICATION FAILED: new parent '${spec.name}' (${id}) not found.`);
    if (project.name !== spec.name) {
      throw new Error(
        `VERIFICATION FAILED: new parent name "${project.name}", expected "${spec.name}".`
      );
    }
    if (project.status !== spec.status) {
      throw new Error(
        `VERIFICATION FAILED: new parent '${spec.name}' status is "${project.status}", expected "${spec.status}".`
      );
    }
    if (project.category !== spec.category) {
      throw new Error(
        `VERIFICATION FAILED: new parent '${spec.name}' category is "${project.category}", expected "${spec.category}".`
      );
    }
    if (project.owner !== spec.owner) {
      throw new Error(
        `VERIFICATION FAILED: new parent '${spec.name}' owner is "${project.owner}", expected "${spec.owner}".`
      );
    }
    if ((project.resources ?? null) !== (spec.resources ?? null)) {
      throw new Error(
        `VERIFICATION FAILED: new parent '${spec.name}' resources is "${project.resources}", expected "${spec.resources ?? null}".`
      );
    }
    if ((project.waitingOn ?? null) !== (spec.waitingOn ?? null)) {
      throw new Error(
        `VERIFICATION FAILED: new parent '${spec.name}' waitingOn is "${project.waitingOn}", expected "${spec.waitingOn ?? null}".`
      );
    }
  }
  ctx.log(`All 3 new parents verified.`);

  // 4. Client team field
  const clientRows = await ctx.db.select().from(clients).where(eq(clients.id, r.convergix.id));
  const client = clientRows[0];
  if (client.team !== CONVERGIX_TEAM_NEW) {
    throw new Error(
      `VERIFICATION FAILED: Convergix team is "${client.team}", expected "${CONVERGIX_TEAM_NEW}".`
    );
  }
  ctx.log(`Client team field verified.`);

  // 5. 3 flip-to-completed projects → status=completed, category=completed
  for (const spec of FLIP_COMPLETED_SPECS) {
    const rows = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.clientId, r.convergix.id), like(projects.id, `${spec.prefix}%`)));
    if (rows.length !== 1) {
      throw new Error(`VERIFICATION FAILED: flip ${spec.prefix} resolved to ${rows.length} rows.`);
    }
    const project = rows[0];
    if (project.status !== "completed") {
      throw new Error(
        `VERIFICATION FAILED: flip ${spec.prefix} (${project.name}) status is "${project.status}", expected "completed".`
      );
    }
    if (project.category !== "completed") {
      throw new Error(
        `VERIFICATION FAILED: flip ${spec.prefix} (${project.name}) category is "${project.category}", expected "completed".`
      );
    }
  }
  ctx.log(`All 3 flip-to-completed projects verified.`);

  // 6. 8 rewires → projectId matches target
  for (const spec of WEEK_ITEM_REWIRE_SPECS) {
    const targetProject = r.projectsByPrefix.get(spec.targetParentPrefix);
    if (!targetProject) {
      throw new Error(`VERIFICATION FAILED: rewire target ${spec.targetParentPrefix} missing.`);
    }
    const rows = await ctx.db
      .select()
      .from(weekItems)
      .where(like(weekItems.id, `${spec.prefix}%`));
    if (rows.length !== 1) {
      throw new Error(`VERIFICATION FAILED: rewire ${spec.prefix} resolved to ${rows.length} rows.`);
    }
    const item = rows[0];
    if (item.projectId !== targetProject.id) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} projectId is ${item.projectId}, expected ${targetProject.id}.`
      );
    }
    if (spec.fields.title !== undefined && item.title !== spec.fields.title) {
      throw new Error(
        `VERIFICATION FAILED: rewire ${spec.prefix} title is "${item.title}", expected "${spec.fields.title}".`
      );
    }
  }
  ctx.log(`All ${WEEK_ITEM_REWIRE_SPECS.length} rewires verified.`);

  // 7. Total week-item count for client: preflight 20 + 17 new = 37
  const allItems = await ctx.db
    .select({ id: weekItems.id })
    .from(weekItems)
    .where(eq(weekItems.clientId, r.convergix.id));
  const expectedItemCount = 20 + CREATE_WEEK_ITEM_SPECS.length;
  if (allItems.length !== expectedItemCount) {
    throw new Error(
      `VERIFICATION FAILED: expected ${expectedItemCount} week items (20 preflight + ${CREATE_WEEK_ITEM_SPECS.length} new), got ${allItems.length}.`
    );
  }
  ctx.log(`Total week items: ${allItems.length} (expected ${expectedItemCount}).`);

  // 8. Total project count: 19 - 7 + 3 = 15
  const allProjects = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.clientId, r.convergix.id));
  const expectedProjectCount = 19 - DELETE_SPECS.length + CREATE_SPECS.length;
  if (allProjects.length !== expectedProjectCount) {
    throw new Error(
      `VERIFICATION FAILED: expected ${expectedProjectCount} projects (19 preflight - ${DELETE_SPECS.length} deletes + ${CREATE_SPECS.length} creates), got ${allProjects.length}.`
    );
  }
  ctx.log(`Total projects: ${allProjects.length} (expected ${expectedProjectCount}).`);

  ctx.log("Verification passed.");
}
