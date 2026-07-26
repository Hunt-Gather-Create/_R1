import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  // v4-schema-plan (2026-07-26): enum enforced at the application layer:
  //   project | retainer | one-off   (default on create: project)
  // Validator posture is tolerant-read / strict-write until the G2 backfill
  // signs off; legacy free-text and NULL remain readable until then.
  engagementType: text("engagement_type"),
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
  // 4-level hierarchy (2026-07-26): L4 task's optional parent L3 section.
  // NO DB-level FK constraint, per the parentProjectId convention below —
  // FK constraints complicate drizzle-kit SQLite migrations and can force a
  // full week_items table rebuild on push. Runtime invariants live in the
  // write helpers: sectionId != null implies projectId == section.projectId
  // (reparent rewrites both atomically); section delete demotes children to
  // sectionId = NULL in the same transaction.
  sectionId: text("section_id"),
  // Sheet-sourced tasks carry their sheet task number (e.g. "3.2");
  // Runway-born tasks under a numbered section auto-append (max+1, numeric
  // parse of the trailing component, gap-preserving on delete). Null for
  // loose tasks and for tasks in Runway-born sections awaiting sheet
  // reconciliation. Minted numbers register in sheet_sync_ledger with
  // state='runway-born' at creation.
  taskNo: text("task_no"),
  // L5 door (unified-hierarchy principle, plan §3.4): every level is potentially
  // actionable AND container. week_items becomes container-capable when real
  // subtask demand appears (revisit trigger: hierarchy-comparison doc, 2026-07-25).
  // Until then, deliberately not shipped:
  // parentTaskId: text("parent_task_id"),  // FK-free self-ref per parentProjectId convention
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

// ============================================================
// Sections — L3 of the 4-level hierarchy (2026-07-26)
// ============================================================
// L1 wrapper (projects) → L2 sub-project (projects.parentProjectId) →
// L3 section (this table) → L4 task (week_items.sectionId).
//
// Unified-hierarchy principle (plan §3.4): every level is potentially
// actionable AND potentially a container, data-driven not schema-driven.
// A section with all 5 actionable fields null is a pure grouping band
// (the default; the sheet-sync engine only ever creates this shape).
// Setting any of them promotes the section to actionable. `status`
// REUSES the L4 week_items status vocabulary — no third enum. Status is
// never auto-derived from children and never auto-flips them. startDate /
// endDate are manual-only; when null the UI shows the derived child range
// grayed, computed at read time — no stored rollups for sections.
export const sections = sqliteTable("sections", {
  id: text("id").primaryKey(),
  // FK-free per the parentProjectId / week_items.sectionId convention (F6):
  // DB-level FK constraints complicate drizzle-kit SQLite migrations and
  // risk a full table rebuild on push. Runtime enforcement lives in the
  // write helpers (createSection verifies the project exists; deleteProject
  // cleans sections in the same transaction).
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  // Actionable-optional fields. Any set = actionable; all null = pure grouping.
  // scheduled | in-progress | blocked | at-risk | completed | canceled
  // (canceled is a status flip, NOT a delete — children stay attached and
  // the digest prompts for child-task handling).
  status: text("status"),
  owner: text("owner"),
  resources: text("resources"), // comma-separated, same convention as projects/week_items
  startDate: text("start_date"), // ISO date; manual only, never stored-derived
  endDate: text("end_date"), // ISO date; manual only
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => [
  // Ordered read of a project's sections
  index("idx_sections_project_id_sort_order").on(table.projectId, table.sortOrder),
]);

// ============================================================
// Sheet Registry — engagement-stable sheet identity (2026-07-26)
// ============================================================
// The versioning flow mints a NEW spreadsheetId per version. Keying sync
// state on the raw sheetId would orphan the ledger on every version bump.
// This table anchors identity on an opaque per-engagement key; the
// versioning flow updates currentSheetId + version in the same transaction
// that logs the `sheet-version` updates row.
export const sheetRegistry = sqliteTable("sheet_registry", {
  engagementKey: text("engagement_key").primaryKey(), // e.g. "lppc-2604-01"
  currentSheetId: text("current_sheet_id").notNull(), // Drive file id of the live sheet
  previousSheetId: text("previous_sheet_id"), // last version, moved to _old/
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ============================================================
// Sheet Sync Ledger — row-identity map for Sheet↔Runway sync (2026-07-26)
// ============================================================
// Generalized two-entity ledger: tasks AND sections. sheetKey is the
// stable in-sheet identity (tasks: taskNo like "2.3"; sections: header
// ordinal like "S2"). Keys on engagementKey (stable across sheet
// versions via sheet_registry), never on raw spreadsheetId.
//
// state values:
//   active            — normal reconciled state
//   sheet-row-missing — ledger entry exists but sheet no longer has this row
//   wi-deleted        — Runway entity was deleted, ledger orphaned
//   flagged           — reconciliation ambiguity, needs operator input
//   runway-born       — minted via Runway auto-append, not yet reconciled
export const sheetSyncLedger = sqliteTable("sheet_sync_ledger", {
  id: text("id").primaryKey(),
  engagementKey: text("engagement_key").notNull(), // references sheet_registry.engagementKey
  entityType: text("entity_type").notNull(), // 'task' | 'section'
  sheetKey: text("sheet_key").notNull(),
  runwayId: text("runway_id").notNull(), // weekItemId or sectionId
  state: text("state").notNull().default("active"),
  lastSyncRunId: text("last_sync_run_id"),
  lastSeenTitle: text("last_seen_title"), // audit only
  lastSeenContentHash: text("last_seen_content_hash"), // hash of structural cols B-J
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  // One ledger row per sheet position per engagement
  uniqueIndex("uq_sheet_sync_ledger_engagement_entity_sheet_key").on(
    table.engagementKey,
    table.entityType,
    table.sheetKey,
  ),
  // Reverse lookup for Phase 2 writeback; guards two sheet rows claiming one entity
  uniqueIndex("uq_sheet_sync_ledger_runway_id").on(table.runwayId),
  // Bulk state reads per engagement
  index("idx_sheet_sync_ledger_engagement_entity").on(table.engagementKey, table.entityType),
]);

// ============================================================
// Meta — schema version + feature flags (2026-07-26)
// ============================================================
// Seeded on the step-1 migration: `schema_version` (marker consumers check
// before writing new-hierarchy fields, e.g. Slack modal helpers no-op if
// version < required) and `feature_flags` (JSON) for staged rollout gates.
export const meta = sqliteTable("_meta", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

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
  // status-change, note, new-item, field-change, week-field-change,
  // new-week-item, delete-week-item, week-reparent, date-override,
  // cascade-date-change, cascade-status, cascade-duedate, undo, etc.
  // v4-schema-plan (2026-07-26) reserves 4 more for the cascade/versioning
  // workstream (see docs/plans + civ-account-manager schema plan §5-§6):
  //   cascade              — cascade telemetry rows (90-day retention sweep)
  //   cascade-decision     — operator digest decision (retained indefinitely)
  //   sheet-version-intent — versioning-flow intent log (crash-resume anchor)
  //   sheet-version        — versioning-flow completion (retained indefinitely)
  updateType: text("update_type"),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  summary: text("summary"),
  metadata: text("metadata"),
  batchId: text("batch_id"),
  // v4 convention (2026-04-21): cascade audit linkage (nullable self-reference, no FK constraint)
  triggeredByUpdateId: text("triggered_by_update_id"),
  slackMessageTs: text("slack_message_ts"),
  // Slack Modal Wave 1 (2026-04-30): audit-source taxonomy. Holds AuditSource
  // TS-union values: "slack-modal-bot" | "slack-modal-slash" | "mcp" |
  // "bot-direct" | "migration" | "cli" | null. Pre-modal-era rows remain
  // NULL by convention; Wave 0d source-tagging sweep eliminates NULLs from
  // new writes.
  source: text("source"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => [
  index("idx_updates_created_at").on(table.createdAt),
]);

export const teamMembers = sqliteTable("team_members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  firstName: text("first_name"),
  fullName: text("full_name"), // e.g. "Allison Shannon"
  nicknames: text("nicknames"), // JSON array of strings, e.g. ["Allie"]
  title: text("title"),
  slackUserId: text("slack_user_id").unique(),
  roleCategory: text("role_category"), // creative, dev, am, pm, leadership, community, contractor, strategy
  accountsLed: text("accounts_led"), // JSON array of client slugs
  channelPurpose: text("channel_purpose"),
  isActive: integer("is_active").notNull().default(1),
  updatedAt: text("updated_at"),
});

// ============================================================
// Bot Modal Proposals — Slack Modal staging table (Wave 1)
// ============================================================
// Captures pending modal proposals from BOTH bot LLM intercept and slash
// commands, covering CREATE and EDIT flows (per v7 §C2 — renamed from v6
// `bot_create_proposals`). One row per intercepted tool call. Rows are
// deleted 24h after reaching a terminal status by the Wave 12 cron.
//
// Lifecycle: pending -> submitted | cancelled | expired | failed.
//
// `kind` discriminates create vs edit. For edits, `target_entity_id` and
// `target_entity_type` point at the row being edited. For creates these are
// null. `intent_group_id` groups multiple proposals from one user message
// (multi-detect chaining); `parent_proposal_id` self-references the parent
// project proposal when child task proposals are staged before the parent
// is saved (`pending_project_name` carries the human-readable hint until
// `resolved_project_id` is filled at parent submit time).
export const botModalProposals = sqliteTable("bot_modal_proposals", {
  id: text("id").primaryKey(),
  userSlackId: text("user_slack_id").notNull(),
  channelId: text("channel_id").notNull(),
  threadTs: text("thread_ts"),
  // tool_name: create_project | create_week_item | create_team_member |
  //            update_project | update_week_item | update_team_member
  toolName: text("tool_name").notNull(),
  kind: text("kind").notNull(), // 'create' | 'edit'
  targetEntityId: text("target_entity_id"), // null for create
  targetEntityType: text("target_entity_type"), // 'week_item' | 'project' | 'team_member' | null
  args: text("args").notNull(), // JSON of LLM-extracted args (incl. isRetainer for create_project; currentValues for edit)
  conversationRef: text("conversation_ref"), // pointer to chat context
  parentProposalId: text("parent_proposal_id"), // FK to self; child task -> parent project
  intentGroupId: text("intent_group_id"), // groups proposals from one user message
  pendingProjectName: text("pending_project_name"), // staged parent project name; nullable
  postedMessageTs: text("posted_message_ts"), // ts of bot's button-bearing reply (for chat.update)
  postedMessageChannel: text("posted_message_channel"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  // status: pending | submitted | cancelled | expired | failed
  status: text("status").notNull(),
  statusReason: text("status_reason"), // error detail when status = 'failed'
  resolvedProjectId: text("resolved_project_id"), // filled at submit time when pending_project_name resolves
}, (table) => [
  // Cron sweeper: pending past expires_at -> expired
  index("idx_bot_modal_proposals_status_expires_at").on(table.status, table.expiresAt),
  // Per-user history (future rate-limit work)
  index("idx_bot_modal_proposals_user_slack_id_created_at").on(table.userSlackId, table.createdAt),
  // Multi-detect sibling lookup on parent submit (drives chat.update)
  index("idx_bot_modal_proposals_intent_group_id_status").on(table.intentGroupId, table.status),
  // Sibling task lookup post-parent-submit
  index("idx_bot_modal_proposals_parent_proposal_id_status").on(table.parentProposalId, table.status),
]);

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
