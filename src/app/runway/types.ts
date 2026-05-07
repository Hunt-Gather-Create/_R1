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
  // ISO timestamp of the project row's last write. Used by detectStaleItems
  // to compute staleness from actual activity rather than the unwritten
  // projects.stale_days column.
  updatedAt?: string | null;
  // v4 (PR #88 Chunk F): retainer wrapper linkage. When set, this project
  // is a deliverable L1 nested under a retainer wrapper with this id.
  // Null/undefined = top-level L1 (current default 2-level behavior).
  // The enriched shape (UnifiedTriageItem) carries resolved `children[]`
  // on wrappers -- see unified-view.ts.
  parentProjectId?: string | null;
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
  // dashboard-cleanup item 1: parent project name for L2 week items.
  // Set when the weekItem's project has a parentProjectId (i.e. it is an
  // L2 nested under an L1 retainer or project). Absent for top-level L1 items.
  parentProjectName?: string | null;
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
  /**
   * Track 4 audit fix (2026-05-05): contract start/end dates surfaced on the
   * By Account client header. Sourced from the retainer wrapper L1's
   * `contractStart`/`contractEnd` fields when one exists; null otherwise.
   * Optional because non-retainer accounts (project-only or pipeline-only)
   * carry no canonical contract dates at the client level.
   */
  contractStart?: string | null;
  contractEnd?: string | null;
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

// ── Gantt rundown extension ──────────────────────────────
//
// Track 3 Wave 3: AccountSection no longer consumes a rundown. The Gantt
// embed has been removed from the By Account tab and will be reintroduced
// on a separate "Gantt Charts" tab in Wave 4. The rundown types below are
// retained because the legacy `/api/runway/gantt-embed` route + helpers
// still reference them.
//
// Track 4 Wave 4.3: AccountSection re-consumes a `rundown` (raw filtered
// `ClientRundownData`) so it can render the new tiered swimlane via
// `<AccountTier ...>`. The Gantt Charts tab continues to consume the
// pre-rendered `ganttContent` ReactNode in parallel — the two views read
// the same upstream filter result through different shapes.

/**
 * A RundownSection descriptor (metadata only — no rendered content).
 * The rendered JSX is passed separately via React's RSC slot mechanism.
 */
export interface RenderedRundownSection {
  anchor: string;
  kind: "wrapper" | "wrapper-child" | "standalone";
  title: string;
  parentTitle?: string;
}

/**
 * Per-client severity + section metadata for the AuditBadge and section
 * grouping. Does NOT include rendered HTML — content is passed as ReactNode
 * via the RSC children pattern (react-dom/server is banned in Next.js 16
 * App Router entrypoints, including route handlers).
 */
export interface RenderedClientRundownData {
  generatedAt: string;
  overallSeverity: import("@/lib/runway/gantt/types").SeverityCounts;
  sections: RenderedRundownSection[];
}
