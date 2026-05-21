import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { RundownContentRSC } from "./rundown-content-rsc";
import type {
  RundownSection,
  GanttData,
  AnnotatedRow,
} from "@/lib/runway/gantt/types";

// Stub GanttSectionDark — the dark-theme bar rendering exercises a wider
// surface (computeAxis, color tokens, etc.) than these chip-suppression
// tests need. The stub keeps the test focused on the <summary> chip logic.
vi.mock("@/lib/runway/gantt/gantt-section-dark", () => ({
  GanttSectionDark: () => null,
}));

// ─── Fixture factories (mirrored from AccountTier.test.tsx) ────────────────

function makeWeekItemRow(overrides: Partial<AnnotatedRow> = {}): AnnotatedRow {
  return {
    kind: "weekitem",
    id: `wi-${Math.random().toString(36).slice(2, 8)}`,
    title: "Weekly deliverable",
    owner: "Lane",
    resources: "CD: Lane",
    startDate: "2026-05-04",
    endDate: "2026-05-08",
    status: "in-progress",
    category: "delivery",
    weekOf: "2026-05-04",
    inline: [],
    subRow: [],
    ...overrides,
  } as AnnotatedRow;
}

function makeGanttData(
  kind: "wrapper" | "l1",
  rows: AnnotatedRow[] = [],
  entityId: string = "p-1",
  entityTitle: string = "Project",
): GanttData {
  const raw =
    kind === "wrapper"
      ? {
          kind: "wrapper" as const,
          entity: { id: entityId, title: entityTitle } as never,
          client: {} as never,
          children: [] as never[],
          orphanWeekItems: [] as { id: string; title: string }[],
        }
      : {
          kind: "l1" as const,
          entity: { id: entityId, title: entityTitle } as never,
          client: {} as never,
          children: [] as never[],
        };

  return {
    raw,
    rows,
    chartIssues: [],
    axis: { kind: "no-axis", today: "2026-05-05" },
    headerRange: "5/4 – 5/8",
    generatedAt: "2026-05-05",
    summary: {
      rowsWithGaps: 0,
      totalRows: rows.length,
      chartIssueCount: 0,
      byCode: {},
      codeSeverity: {},
      severity: { critical: 0, warn: 0, info: 0 },
      chartIssues: [],
    },
  };
}

function makeSection(
  kind: "wrapper" | "wrapper-child" | "standalone",
  title: string,
  rows: AnnotatedRow[] = [],
  parentTitle?: string,
  entityId: string = `${kind}-${title}`.replace(/\s+/g, "-").toLowerCase(),
): RundownSection {
  const dataKind = kind === "wrapper" ? "wrapper" : "l1";
  return {
    anchor: title.toLowerCase().replace(/\s+/g, "-"),
    kind,
    title,
    parentTitle,
    data: makeGanttData(dataKind, rows, entityId, title),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("RundownContentRSC — Issue #41 chip suppression on empty sections", () => {
  it("suppresses ReadyToClose chip on empty wrapper-child even when its id is in readyToCloseIds", () => {
    const sections: RundownSection[] = [
      makeSection("wrapper", "Q2 Retainer", [], undefined, "wrap-1"),
      // Wrapper-child with NO weekItems — empty.
      makeSection("wrapper-child", "Empty Child L1", [], "Q2 Retainer", "l1-empty-child"),
    ];
    const { container } = render(
      <RundownContentRSC
        sections={sections}
        readyToCloseIds={new Set(["l1-empty-child"])}
      />,
    );
    // NoScheduledTasks chip still renders.
    expect(container.querySelector('[data-testid="no-scheduled-tasks-chip"]')).toBeTruthy();
    // ReadyToClose chip must NOT render — empty + ready-to-close is a contradiction.
    expect(container.querySelector('[data-testid="ready-to-close-chip"]')).toBeNull();
  });

  it("suppresses ReadyToClose chip on empty standalone L1 even when its id is in readyToCloseIds", () => {
    const sections: RundownSection[] = [
      // Standalone L1 with no weekItems.
      makeSection("standalone", "Empty Standalone L1", [], undefined, "l1-empty-standalone"),
    ];
    const { container } = render(
      <RundownContentRSC
        sections={sections}
        readyToCloseIds={new Set(["l1-empty-standalone"])}
      />,
    );
    expect(container.querySelector('[data-testid="no-scheduled-tasks-chip"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ready-to-close-chip"]')).toBeNull();
  });

  it("still renders ReadyToClose chip on a NON-empty L1 whose id is in readyToCloseIds (regression)", () => {
    // Row must NOT be terminal — weekItemsForSection filters completed/canceled
    // out, so a section full of terminal rows would itself read as empty.
    const sections: RundownSection[] = [
      makeSection(
        "standalone",
        "Closing L1",
        [makeWeekItemRow({ status: "in-progress" })],
        undefined,
        "l1-closing",
      ),
    ];
    const { container } = render(
      <RundownContentRSC
        sections={sections}
        readyToCloseIds={new Set(["l1-closing"])}
      />,
    );
    expect(container.querySelector('[data-testid="ready-to-close-chip"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="no-scheduled-tasks-chip"]')).toBeNull();
  });
});
