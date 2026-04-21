import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// ============================================================
// Runway Database Schema — Separate Turso DB
// Phase 0: Triage board, Slack bot, MCP server
// ============================================================

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  nicknames: text("nicknames"), // JSON array of strings, e.g. ["CGX", "Convergix"]
  contractValue: text("contract_value"),
  contractTerm: text("contract_term"),
  contractStatus: text("contract_status"), // signed, unsigned, expired
  team: text("team"),
  clientContacts: text("client_contacts"), // JSON array of {name, role?} objects
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id),
  name: text("name").notNull(),
  status: text("status"), // in-production, awaiting-client, not-started, blocked, on-hold, completed
  category: text("category"), // active, awaiting-client, pipeline, on-hold, completed
  owner: text("owner"),
  resources: text("resources"), // comma-separated list of people doing the work
  waitingOn: text("waiting_on"),
  dueDate: text("due_date"),
  // v4 convention (2026-04-21): timing fields
  startDate: text("start_date"), // ISO date; derived from children, recomputed on L2 write
  endDate: text("end_date"), // ISO date; derived from children, recomputed on L2 write
  contractStart: text("contract_start"), // ISO date; manual override for retainers
  contractEnd: text("contract_end"), // ISO date; manual override for retainers
  engagementType: text("engagement_type"), // project, retainer, break-fix
  // v4 convention (2026-04-21 / PR #88 Chunk F): optional self-reference for
  // retainer wrappers. When set, this project is a deliverable L1 nested
  // under a retainer wrapper L1. Null for top-level projects. No DB-level
  // FK constraint (self-references complicate drizzle-kit migrations on
  // SQLite) -- runtime enforcement lives in the application layer.
  parentProjectId: text("parent_project_id"),
  notes: text("notes"),
  staleDays: integer("stale_days"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const weekItems = sqliteTable("week_items", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  clientId: text("client_id").references(() => clients.id),
  dayOfWeek: text("day_of_week"), // monday, tuesday, etc.
  weekOf: text("week_of"), // ISO date of the Monday (e.g. "2026-04-06")
  date: text("date"), // exact date (e.g. "2026-04-07") — legacy; replaced by startDate in v4
  // v4 convention (2026-04-21): start/end dates + explicit dependencies
  startDate: text("start_date"), // ISO date; backfilled from `date`. Treated as required post-backfill.
  endDate: text("end_date"), // ISO date; null for single-day items
  blockedBy: text("blocked_by"), // JSON array of week_item ids (e.g. `["abc","def"]`)
  title: text("title").notNull(),
  // L2 status values (v4 convention, PR #88 Chunk D):
  //   completed | in-progress | blocked | at-risk | scheduled | canceled | null (legacy)
  // `scheduled` is the explicit default for new L2s. NULL remains readable
  // during the rollout and is treated equivalently to 'scheduled' by the
  // bucket + filter paths. The backfill script
  // scripts/runway-migrations/2026-04-21-backfill-scheduled-status.ts flips
  // existing NULLs to the explicit value.
  status: text("status"),
  category: text("category"), // delivery, review, kickoff, deadline, approval, launch
  owner: text("owner"),
  resources: text("resources"), // comma-separated list of people doing the work
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => [
  index("idx_week_items_week_of").on(table.weekOf),
]);

export const pipelineItems = sqliteTable("pipeline_items", {
  id: text("id").primaryKey(),
  clientId: text("client_id").references(() => clients.id),
  name: text("name").notNull(),
  owner: text("owner"),
  status: text("status"), // scoping, drafting, sow-sent, verbal, signed, at-risk
  estimatedValue: text("estimated_value"), // display string like "$55,000" or "TBD"
  waitingOn: text("waiting_on"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const updates = sqliteTable("updates", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").unique(),
  projectId: text("project_id").references(() => projects.id),
  clientId: text("client_id").references(() => clients.id),
  updatedBy: text("updated_by"),
  updateType: text("update_type"), // status-change, note, new-item, etc.
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  summary: text("summary"),
  metadata: text("metadata"),
  batchId: text("batch_id"),
  // v4 convention (2026-04-21): cascade audit linkage (nullable self-reference, no FK constraint)
  triggeredByUpdateId: text("triggered_by_update_id"),
  slackMessageTs: text("slack_message_ts"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const teamMembers = sqliteTable("team_members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  firstName: text("first_name"),
  fullName: text("full_name"), // e.g. "Allison Shannon"
  nicknames: text("nicknames"), // JSON array of strings, e.g. ["Allie"]
  title: text("title"),
  slackUserId: text("slack_user_id").unique(),
  roleCategory: text("role_category"), // creative, dev, am, pm, leadership, community, contractor
  accountsLed: text("accounts_led"), // JSON array of client slugs
  channelPurpose: text("channel_purpose"),
  isActive: integer("is_active").notNull().default(1),
  updatedAt: text("updated_at"),
});

// ============================================================
// View Preferences — per-scope UI state persistence
// ============================================================
// Runway is currently single-tenant (no workspaces in the Runway DB).
// `scope` keys the row: "global" for shared board preferences; future
// per-user keys (e.g. slack user id) can coexist without a migration.
// `preferences` is a JSON blob: { inFlightToggle?: boolean, ... }.
// v4 (2026-04-21): introduced for In Flight toggle persistence.
export const viewPreferences = sqliteTable("view_preferences", {
  scope: text("scope").primaryKey(),
  preferences: text("preferences").notNull(), // JSON
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
