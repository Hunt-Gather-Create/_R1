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
  waitingOn?: string;
  target?: string;
  notes?: string;
  staleDays?: number;
}

export interface DayItemEntry {
  title: string;
  account: string;
  owner?: string;
  type: DayItemType;
  notes?: string;
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
  status: "sow-sent" | "drafting" | "no-sow" | "verbal";
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
