import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ============================================================
// Runway Database Schema — Separate Turso DB
// Phase 0: Triage board, Slack bot, MCP server
// ============================================================

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  contractValue: text("contract_value"),
  contractTerm: text("contract_term"),
  contractStatus: text("contract_status"), // signed, unsigned, expired
  team: text("team"),
  clientContacts: text("client_contacts"), // JSON array of contact names
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
  waitingOn: text("waiting_on"),
  target: text("target"),
  dueDate: text("due_date"),
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
  date: text("date"), // exact date (e.g. "2026-04-07")
  title: text("title").notNull(),
  status: text("status"),
  category: text("category"), // delivery, review, kickoff, deadline, approval, launch
  owner: text("owner"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const pipelineItems = sqliteTable("pipeline_items", {
  id: text("id").primaryKey(),
  clientId: text("client_id").references(() => clients.id),
  name: text("name").notNull(),
  status: text("status"), // sow-sent, drafting, no-sow, verbal
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
  slackMessageTs: text("slack_message_ts"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const teamMembers = sqliteTable("team_members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title"),
  slackUserId: text("slack_user_id").unique(),
  channelPurpose: text("channel_purpose"),
  isActive: integer("is_active").notNull().default(1),
});
