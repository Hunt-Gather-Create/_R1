/** Shared synthetic sheet, ledger and Runway bundle for the diff stage tests. */
import type { RunwayClientBundle } from "./runway-read";
import type { LeafTask, Ledger, ParsedSheet, SheetConfig } from "./types";

export const CONFIG: SheetConfig = {
  sheetId: "synthetic-sheet-id",
  clientSlug: "acme",
  engagementCode: "ACM-2601-01",
  label: "Widget Refresh",
};

export function leaf(over: Partial<LeafTask>): LeafTask {
  return {
    rowNumber: 12,
    taskNo: "1.1",
    rawLabel: "   1.1 Kickoff call",
    title: "Kickoff call",
    resolvedTitle: "Kickoff call",
    startDate: "2026-06-01",
    endDate: "2026-06-01",
    weekOf: "2026-06-01",
    completed: false,
    derivedStatus: "scheduled",
    category: "kickoff",
    section: null,
    priority: null,
    predecessorRow: null,
    lag: null,
    resource: null,
    notes: "[Sheet 1.1]",
    notesTruncated: false,
    sortOrder: 0,
    ...over,
  };
}

export function parsedWith(tasks: LeafTask[], flags: string[] = []): ParsedSheet {
  return {
    config: CONFIG,
    meta: {
      bannerVariant: "A",
      engagementTitle: "Widget Refresh",
      bannerCode: "ACM-2601-01",
      codeDrift: false,
      headerRowNumber: 10,
    },
    rows: [],
    leafTasks: tasks,
    flags,
  };
}

export function emptyLedger(): Ledger {
  return { sheetId: CONFIG.sheetId, updatedAt: "", lastRunId: "", entries: {} };
}

export const BUNDLE: RunwayClientBundle = {
  client: { id: "cl_1", slug: "acme", name: "Acme" },
  projects: [
    {
      id: "p_widget",
      name: "Widget Refresh",
      status: "in-progress",
      category: null,
      notes: "ACM-2601-01 SOW",
    },
    {
      id: "p_other",
      name: "Brand Guidelines",
      status: "in-progress",
      category: null,
      notes: null,
    },
  ],
  weekItems: [
    {
      id: "wi_kick",
      projectId: "p_widget",
      title: "Kickoff call",
      weekOf: "2026-06-01",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      status: "completed",
      category: "kickoff",
      notes: null,
    },
    {
      id: "wi_comps",
      projectId: "p_widget",
      title: "Comps",
      weekOf: "2026-06-01",
      startDate: "2026-06-02",
      endDate: "2026-06-04",
      status: "blocked",
      category: "delivery",
      notes: null,
    },
    {
      id: "wi_hand",
      projectId: "p_widget",
      title: "Hand-created legacy item",
      weekOf: "2026-06-08",
      startDate: null,
      endDate: null,
      status: null,
      category: null,
      notes: null,
    },
    {
      id: "wi_othr",
      projectId: "p_other",
      title: "Logo pass",
      weekOf: "2026-06-01",
      startDate: null,
      endDate: null,
      status: null,
      category: null,
      notes: null,
    },
  ],
};
