// ── UI Types ────────────────────────────────────────────
// These represent the shape consumed by RunwayBoard components.
// page.tsx maps DB shapes to these types.

export type ItemStatus =
  | "in-production"
  | "awaiting-client"
  | "not-started"
  | "blocked"
  | "on-hold"
  | "completed";

export type ItemCategory =
  | "active"
  | "awaiting-client"
  | "pipeline"
  | "on-hold"
  | "completed";

export type DayItemType =
  | "delivery"
  | "review"
  | "kickoff"
  | "deadline"
  | "approval"
  | "launch"
  | "blocked";

export interface TriageItem {
  id: string;
  title: string;
  status: ItemStatus;
  category: ItemCategory;
  owner?: string;
  resources?: string;
  waitingOn?: string;
  notes?: string;
  staleDays?: number;
  // v4: timing + retainer metadata for soft surfaces
  startDate?: string | null;
  endDate?: string | null;
  engagementType?: "project" | "retainer" | "break-fix" | null;
  contractEnd?: string | null;
}

export interface DayItemEntry {
  id?: string;
  projectId?: string | null;
  title: string;
  account: string;
  owner?: string;
  resources?: string;
  type: DayItemType;
  notes?: string;
  // v4: L2 status enables status-aware filters in flag detectors.
  // null/undefined = not-started; "in-progress" | "blocked" | "completed".
  status?: string | null;
  // v4: start/end dates + dependency chain. End null = single-day item.
  startDate?: string | null;
  endDate?: string | null;
  // Milliseconds since epoch — used for past-end "last touched N days ago" math.
  updatedAtMs?: number | null;
  // v4: explicit dependency on upstream L2 ids (runway-v4-convention.md §"blocked_by").
  // Resolved blockers carry title/status for inline rendering when visible.
  blockedBy?: BlockedByRef[] | null;
}

export interface BlockedByRef {
  id: string;
  title: string;
  status?: string | null;
}

export interface DayItem {
  date: string;
  label: string;
  items: DayItemEntry[];
}

export interface Account {
  name: string;
  slug: string;
  contractValue?: string;
  contractTerm?: string;
  contractStatus: "signed" | "unsigned" | "expired";
  team?: string;
  items: TriageItem[];
}

export interface PipelineItem {
  account: string;
  title: string;
  value: string;
  status: "scoping" | "drafting" | "sow-sent" | "verbal" | "signed" | "at-risk";
  owner?: string;
  waitingOn?: string;
  notes?: string;
}

// ── DB Types ────────────────────────────────────────────
// These depend on Drizzle schema imports, kept here to avoid
// schema imports leaking into UI components.

import { clients, projects, pipelineItems } from "@/lib/db/runway-schema";

export type ClientWithProjects = typeof clients.$inferSelect & {
  items: (typeof projects.$inferSelect)[];
};

export type WeekDay = {
  date: string;
  label: string;
  items: DayItemEntry[];
};

export type PipelineRow = typeof pipelineItems.$inferSelect & {
  accountName: string | null;
};
