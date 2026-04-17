/**
 * Test DB helper — in-memory SQLite for integration tests
 *
 * Creates a fresh Drizzle instance backed by an in-memory SQLite database
 * with the full Runway schema and realistic seed data.
 */

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import * as schema from "@/lib/db/runway-schema";

// ── DDL ─────────────────────────────────────────────────

const DDL = `
CREATE TABLE clients (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  nicknames TEXT,
  contract_value TEXT,
  contract_term TEXT,
  contract_status TEXT,
  team TEXT,
  client_contacts TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  status TEXT,
  category TEXT,
  owner TEXT,
  resources TEXT,
  waiting_on TEXT,
  target TEXT,
  due_date TEXT,
  notes TEXT,
  stale_days INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE week_items (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id),
  client_id TEXT REFERENCES clients(id),
  day_of_week TEXT,
  week_of TEXT,
  date TEXT,
  title TEXT NOT NULL,
  status TEXT,
  category TEXT,
  owner TEXT,
  resources TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_week_items_week_of ON week_items(week_of);

CREATE TABLE pipeline_items (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT REFERENCES clients(id),
  name TEXT NOT NULL,
  owner TEXT,
  status TEXT,
  estimated_value TEXT,
  waiting_on TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE updates (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT UNIQUE,
  project_id TEXT REFERENCES projects(id),
  client_id TEXT REFERENCES clients(id),
  updated_by TEXT,
  update_type TEXT,
  previous_value TEXT,
  new_value TEXT,
  summary TEXT,
  metadata TEXT,
  slack_message_ts TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE team_members (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  first_name TEXT,
  full_name TEXT,
  nicknames TEXT,
  title TEXT,
  slack_user_id TEXT UNIQUE,
  role_category TEXT,
  accounts_led TEXT,
  channel_purpose TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);
`;

// ── Seed Data ───────────────────────────────────────────

const NOW_EPOCH = Math.floor(Date.now() / 1000);

const SEED_SQL = `
INSERT INTO clients (id, name, slug, nicknames, created_at, updated_at) VALUES
  ('cl-convergix', 'Convergix', 'convergix', '["CGX","Convergix"]', ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('cl-bonterra', 'Bonterra', 'bonterra', '["Bonterra"]', ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('cl-lppc', 'LPPC', 'lppc', '["LPPC"]', ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('cl-ag1', 'AG1', 'ag1', '["AG1"]', ${NOW_EPOCH}, ${NOW_EPOCH});

INSERT INTO projects (id, client_id, name, status, category, owner, due_date, sort_order, created_at, updated_at) VALUES
  ('pj-cds', 'cl-convergix', 'CDS Messaging', 'in-production', 'active', 'Kathy', '2026-04-25', 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('pj-social-cgx', 'cl-convergix', 'Social Content', 'not-started', 'active', 'Lane', NULL, 1, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('pj-impact', 'cl-bonterra', 'Impact Report', 'in-production', 'active', 'Jill', '2026-05-15', 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('pj-map', 'cl-lppc', 'Map R2', 'in-production', 'active', 'Ronan', '2026-04-20', 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('pj-social-ag1', 'cl-ag1', 'Social Content Trial', 'in-production', 'active', 'Sami', NULL, 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('pj-brand', 'cl-convergix', 'ABM Brand Guidelines', 'awaiting-client', 'active', 'Kathy', NULL, 2, ${NOW_EPOCH}, ${NOW_EPOCH});

INSERT INTO week_items (id, project_id, client_id, week_of, date, title, status, category, owner, resources, sort_order, created_at, updated_at) VALUES
  ('wi-cds-review', 'pj-cds', 'cl-convergix', '2026-04-13', '2026-04-14', 'CDS Copy Review', NULL, 'review', 'Kathy', 'Roz', 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('wi-cds-deliver', 'pj-cds', 'cl-convergix', '2026-04-13', '2026-04-16', 'CDS Video Delivery', 'in-progress', 'delivery', 'Lane', NULL, 1, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('wi-impact-dl', 'pj-impact', 'cl-bonterra', '2026-04-13', '2026-05-15', 'Impact Report Deadline', NULL, 'deadline', 'Jill', NULL, 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('wi-map-dl', 'pj-map', 'cl-lppc', '2026-04-13', '2026-04-20', 'Map R2 Launch Deadline', NULL, 'deadline', 'Ronan', NULL, 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('wi-social', 'pj-social-ag1', 'cl-ag1', '2026-04-13', '2026-04-15', 'AG1 Social Drafts', NULL, 'delivery', 'Sami', NULL, 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('wi-completed', 'pj-cds', 'cl-convergix', '2026-04-13', '2026-04-13', 'CDS Brief Completed', 'completed', 'delivery', 'Kathy', NULL, 2, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('wi-canceled', 'pj-cds', 'cl-convergix', '2026-04-13', '2026-04-13', 'CDS Retro Canceled', 'canceled', 'review', 'Kathy', NULL, 3, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('wi-other-week', 'pj-map', 'cl-lppc', '2026-04-06', '2026-04-07', 'Map R2 Kickoff', NULL, 'kickoff', 'Ronan', NULL, 0, ${NOW_EPOCH}, ${NOW_EPOCH});

INSERT INTO pipeline_items (id, client_id, name, owner, status, estimated_value, waiting_on, notes, sort_order, created_at, updated_at) VALUES
  ('pl-cgx-sow', 'cl-convergix', 'SOW Expansion', 'Kathy', 'proposal', '50000', 'Client review', 'Pending budget approval', 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('pl-bonterra-renewal', 'cl-bonterra', 'Annual Renewal', 'Jill', 'negotiation', '120000', NULL, NULL, 1, ${NOW_EPOCH}, ${NOW_EPOCH}),
  ('pl-new-lead', NULL, 'Inbound Lead - Acme', 'Lane', 'qualification', '30000', 'Discovery call', NULL, 2, ${NOW_EPOCH}, ${NOW_EPOCH});
`;

// ── Public API ──────────────────────────────────────────

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Creates a fresh SQLite DB for testing.
 *
 * Uses a temp file instead of file::memory: because drizzle-orm/libsql
 * opens a new connection for transactions, and file::memory: gives each
 * connection its own isolated database (tables disappear inside tx).
 */
export async function createTestDb(): Promise<{ client: Client; db: TestDb; dbPath: string }> {
  const dbPath = `/tmp/test-runway-${randomUUID().slice(0, 8)}.db`;
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });
  return { client, db, dbPath };
}

export async function seedTestDb(client: Client): Promise<void> {
  await client.executeMultiple(DDL);
  await client.executeMultiple(SEED_SQL);
}

export function cleanupTestDb(dbPath: string): void {
  try {
    unlinkSync(dbPath);
  } catch {
    // Already cleaned up
  }
}

// ── Verification Helpers ────────────────────────────────

export async function getProject(db: TestDb, id: string) {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id));
  return rows[0] ?? null;
}

export async function getWeekItem(db: TestDb, id: string) {
  const rows = await db
    .select()
    .from(schema.weekItems)
    .where(eq(schema.weekItems.id, id));
  return rows[0] ?? null;
}

export async function getAuditRecords(
  db: TestDb,
  filter?: { updatedBy?: string; updateType?: string }
) {
  let rows = await db.select().from(schema.updates);
  if (filter?.updatedBy) rows = rows.filter((r) => r.updatedBy === filter.updatedBy);
  if (filter?.updateType) rows = rows.filter((r) => r.updateType === filter.updateType);
  return rows;
}

export async function countAuditRecords(db: TestDb) {
  const rows = await db.select().from(schema.updates);
  return rows.length;
}

export async function getAllWeekItemsForProject(db: TestDb, projectId: string) {
  return db
    .select()
    .from(schema.weekItems)
    .where(eq(schema.weekItems.projectId, projectId));
}

export async function getClient(db: TestDb, id: string) {
  const rows = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, id));
  return rows[0] ?? null;
}

export async function getAllPipelineItems(db: TestDb) {
  return db.select().from(schema.pipelineItems);
}
