import { describe, expect, it } from "vitest";
import {
  filterActiveRundown,
  isL1Hidden,
  isReadyToClose,
  isWrapperHidden,
} from "./filter-active";
import type {
  ClientRow,
  ClientRundownData,
  GanttData,
  ProjectRow,
  RawData,
  RundownSection,
  WeekItemRow,
} from "./types";

const NOW = new Date("2026-05-04T00:00:00Z");

// ── Factory helpers ──────────────────────────────────────

function makeClient(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: "c-default",
    name: "Default Client",
    slug: "default-client",
    nicknames: null,
    contractValue: null,
    contractTerm: null,
    contractStatus: null,
    team: null,
    clientContacts: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p-default",
    clientId: "c-default",
    name: "Default Project",
    status: null,
    category: null,
    owner: null,
    resources: null,
    waitingOn: null,
    dueDate: null,
    startDate: null,
    endDate: null,
    contractStart: null,
    contractEnd: null,
    engagementType: null,
    parentProjectId: null,
    notes: null,
    staleDays: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeWeekItem(overrides: Partial<WeekItemRow> = {}): WeekItemRow {
  return {
    id: "w-default",
    projectId: "p-default",
    clientId: "c-default",
    dayOfWeek: null,
    weekOf: null,
    date: null,
    startDate: null,
    endDate: null,
    blockedBy: null,
    title: "Default WeekItem",
    status: null,
    category: null,
    owner: null,
    resources: null,
    notes: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * Build a stub GanttData for an L1 section. `filterActiveRundown` only reads
 * `data.raw`, so we cast a minimal shape that covers what the filter touches.
 */
function makeL1Data(entity: ProjectRow): GanttData {
  const raw: RawData = {
    kind: "l1",
    entity,
    client: makeClient(),
    children: [],
  };
  return { raw } as unknown as GanttData;
}

function makeWrapperData(
  entity: ProjectRow,
  children: ProjectRow[],
  orphanWeekItems: { id: string; title: string }[] = [],
): GanttData {
  const raw: RawData = {
    kind: "wrapper",
    entity,
    client: makeClient(),
    children,
    orphanWeekItems,
  };
  return { raw } as unknown as GanttData;
}

function makeSection(overrides: Partial<RundownSection> = {}): RundownSection {
  return {
    anchor: "anchor-default",
    kind: "standalone",
    title: "Default Section",
    data: makeL1Data(makeProject()),
    ...overrides,
  };
}

function makeRundown(
  sections: RundownSection[],
  overrides: Partial<ClientRundownData> = {},
): ClientRundownData {
  return {
    client: makeClient(),
    sections,
    generatedAt: "2026-05-04",
    overallSeverity: { critical: 0, warn: 0, info: 0 },
    ...overrides,
  };
}

// ── isL1Hidden ───────────────────────────────────────────

describe("isL1Hidden", () => {
  it("returns true when status is 'completed'", () => {
    expect(isL1Hidden(makeProject({ status: "completed" }))).toBe(true);
  });

  it("returns true when status is 'canceled'", () => {
    expect(isL1Hidden(makeProject({ status: "canceled" }))).toBe(true);
  });

  it("returns false when status is 'in-production'", () => {
    expect(isL1Hidden(makeProject({ status: "in-production" }))).toBe(false);
  });

  it("returns false when status is 'not-started'", () => {
    expect(isL1Hidden(makeProject({ status: "not-started" }))).toBe(false);
  });

  it("returns false when status is 'awaiting-client'", () => {
    expect(isL1Hidden(makeProject({ status: "awaiting-client" }))).toBe(false);
  });

  it("returns false when status is 'blocked'", () => {
    expect(isL1Hidden(makeProject({ status: "blocked" }))).toBe(false);
  });

  it("returns false when status is 'on-hold'", () => {
    expect(isL1Hidden(makeProject({ status: "on-hold" }))).toBe(false);
  });

  it("returns false when status is null", () => {
    expect(isL1Hidden(makeProject({ status: null }))).toBe(false);
  });
});

// ── isWrapperHidden ──────────────────────────────────────

describe("isWrapperHidden", () => {
  const wrapper = makeProject({ id: "p-wrap", name: "Wrapper" });

  it("returns true when all children hidden + no orphans", () => {
    const kids = [
      makeProject({ id: "k1", status: "completed" }),
      makeProject({ id: "k2", status: "canceled" }),
    ];
    expect(isWrapperHidden(wrapper, kids, [])).toBe(true);
  });

  it("returns false when one child is active + no orphans", () => {
    const kids = [
      makeProject({ id: "k1", status: "completed" }),
      makeProject({ id: "k2", status: "in-production" }),
    ];
    expect(isWrapperHidden(wrapper, kids, [])).toBe(false);
  });

  it("returns false when all children hidden but one orphan is in-progress", () => {
    const kids = [makeProject({ id: "k1", status: "completed" })];
    const orphans = [makeWeekItem({ id: "w1", status: "in-progress" })];
    expect(isWrapperHidden(wrapper, kids, orphans)).toBe(false);
  });

  it("returns true when all children hidden + one orphan canceled", () => {
    const kids = [makeProject({ id: "k1", status: "completed" })];
    const orphans = [makeWeekItem({ id: "w1", status: "canceled" })];
    expect(isWrapperHidden(wrapper, kids, orphans)).toBe(true);
  });

  it("returns true when all children hidden + one orphan completed", () => {
    const kids = [makeProject({ id: "k1", status: "completed" })];
    const orphans = [makeWeekItem({ id: "w1", status: "completed" })];
    expect(isWrapperHidden(wrapper, kids, orphans)).toBe(true);
  });

  it("returns false when all children hidden + one orphan with status null (null = scheduled)", () => {
    const kids = [makeProject({ id: "k1", status: "completed" })];
    const orphans = [makeWeekItem({ id: "w1", status: null })];
    expect(isWrapperHidden(wrapper, kids, orphans)).toBe(false);
  });

  it("returns false when wrapper has no kids and no orphans (degenerate — nothing to hide)", () => {
    expect(isWrapperHidden(wrapper, [], [])).toBe(false);
  });

  it("returns false when all children hidden + multiple orphans mixed (one active, one done)", () => {
    const kids = [makeProject({ id: "k1", status: "completed" })];
    const orphans = [
      makeWeekItem({ id: "w1", status: "completed" }),
      makeWeekItem({ id: "w2", status: "in-progress" }),
    ];
    expect(isWrapperHidden(wrapper, kids, orphans)).toBe(false);
  });

  it("returns true when all children hidden + all orphans terminal (mix of completed + canceled)", () => {
    const kids = [makeProject({ id: "k1", status: "completed" })];
    const orphans = [
      makeWeekItem({ id: "w1", status: "completed" }),
      makeWeekItem({ id: "w2", status: "canceled" }),
    ];
    expect(isWrapperHidden(wrapper, kids, orphans)).toBe(true);
  });
});

// ── isReadyToClose ───────────────────────────────────────

describe("isReadyToClose", () => {
  it("returns false when L1 has 0 weekItems (no rollup signal)", () => {
    const l1 = makeProject({ status: "in-production" });
    expect(isReadyToClose(l1, [])).toBe(false);
  });

  it("returns true when all weekItems completed + L1 status 'in-production'", () => {
    const l1 = makeProject({ status: "in-production" });
    const items = [
      makeWeekItem({ id: "w1", status: "completed" }),
      makeWeekItem({ id: "w2", status: "completed" }),
    ];
    expect(isReadyToClose(l1, items)).toBe(true);
  });

  it("returns true when all weekItems completed + L1 status 'not-started'", () => {
    const l1 = makeProject({ status: "not-started" });
    const items = [makeWeekItem({ id: "w1", status: "completed" })];
    expect(isReadyToClose(l1, items)).toBe(true);
  });

  it("returns true when all weekItems completed + L1 status null", () => {
    const l1 = makeProject({ status: null });
    const items = [makeWeekItem({ id: "w1", status: "completed" })];
    expect(isReadyToClose(l1, items)).toBe(true);
  });

  it("returns false when all weekItems completed + L1 status 'completed' (already closed)", () => {
    const l1 = makeProject({ status: "completed" });
    const items = [makeWeekItem({ id: "w1", status: "completed" })];
    expect(isReadyToClose(l1, items)).toBe(false);
  });

  it("returns false when all weekItems completed + L1 status 'canceled' (already closed)", () => {
    const l1 = makeProject({ status: "canceled" });
    const items = [makeWeekItem({ id: "w1", status: "completed" })];
    expect(isReadyToClose(l1, items)).toBe(false);
  });

  it("returns false when one weekItem in-progress + rest completed", () => {
    const l1 = makeProject({ status: "in-production" });
    const items = [
      makeWeekItem({ id: "w1", status: "completed" }),
      makeWeekItem({ id: "w2", status: "in-progress" }),
    ];
    expect(isReadyToClose(l1, items)).toBe(false);
  });

  it("returns false when one weekItem null + rest completed (null = scheduled)", () => {
    const l1 = makeProject({ status: "in-production" });
    const items = [
      makeWeekItem({ id: "w1", status: "completed" }),
      makeWeekItem({ id: "w2", status: null }),
    ];
    expect(isReadyToClose(l1, items)).toBe(false);
  });

  it("returns false when one weekItem canceled + rest completed (canceled is not completed)", () => {
    const l1 = makeProject({ status: "in-production" });
    const items = [
      makeWeekItem({ id: "w1", status: "completed" }),
      makeWeekItem({ id: "w2", status: "canceled" }),
    ];
    expect(isReadyToClose(l1, items)).toBe(false);
  });
});

// ── filterActiveRundown ──────────────────────────────────

describe("filterActiveRundown", () => {
  it("returns empty sections when input has no sections", () => {
    const out = filterActiveRundown(makeRundown([]));
    expect(out.sections).toEqual([]);
  });

  it("preserves a single active standalone L1", () => {
    const l1 = makeProject({ id: "p-l1", status: "in-production" });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-l1",
        kind: "standalone",
        title: "Project One",
        data: makeL1Data(l1),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].anchor).toBe("p-l1");
  });

  it("filters out a single completed standalone L1", () => {
    const l1 = makeProject({ id: "p-l1", status: "completed" });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-l1",
        kind: "standalone",
        title: "Project One",
        data: makeL1Data(l1),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections).toEqual([]);
  });

  it("filters out a canceled standalone L1", () => {
    const l1 = makeProject({ id: "p-l1", status: "canceled" });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-l1",
        kind: "standalone",
        title: "Project One",
        data: makeL1Data(l1),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections).toEqual([]);
  });

  it("preserves a wrapper with all-active children", () => {
    const wrapper = makeProject({
      id: "p-wrap",
      name: "Wrapper",
      engagementType: "retainer",
    });
    const childA = makeProject({
      id: "p-a",
      parentProjectId: "p-wrap",
      status: "in-production",
    });
    const childB = makeProject({
      id: "p-b",
      parentProjectId: "p-wrap",
      status: "blocked",
    });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-wrap",
        kind: "wrapper",
        title: "Wrapper",
        data: makeWrapperData(wrapper, [childA, childB]),
      }),
      makeSection({
        anchor: "p-a",
        kind: "wrapper-child",
        title: "Child A",
        parentTitle: "Wrapper",
        data: makeL1Data(childA),
      }),
      makeSection({
        anchor: "p-b",
        kind: "wrapper-child",
        title: "Child B",
        parentTitle: "Wrapper",
        data: makeL1Data(childB),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections.map((s) => s.anchor)).toEqual([
      "p-wrap",
      "p-a",
      "p-b",
    ]);
  });

  it("filters out wrapper + all wrapper-children when all children completed and no orphans", () => {
    const wrapper = makeProject({ id: "p-wrap", name: "Wrapper" });
    const childA = makeProject({
      id: "p-a",
      parentProjectId: "p-wrap",
      status: "completed",
    });
    const childB = makeProject({
      id: "p-b",
      parentProjectId: "p-wrap",
      status: "canceled",
    });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-wrap",
        kind: "wrapper",
        title: "Wrapper",
        data: makeWrapperData(wrapper, [childA, childB]),
      }),
      makeSection({
        anchor: "p-a",
        kind: "wrapper-child",
        title: "Child A",
        parentTitle: "Wrapper",
        data: makeL1Data(childA),
      }),
      makeSection({
        anchor: "p-b",
        kind: "wrapper-child",
        title: "Child B",
        parentTitle: "Wrapper",
        data: makeL1Data(childB),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections).toEqual([]);
  });

  it("keeps wrapper section when one child is active; drops only completed wrapper-children", () => {
    const wrapper = makeProject({ id: "p-wrap", name: "Wrapper" });
    const childA = makeProject({
      id: "p-a",
      parentProjectId: "p-wrap",
      status: "completed",
    });
    const childB = makeProject({
      id: "p-b",
      parentProjectId: "p-wrap",
      status: "in-production",
    });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-wrap",
        kind: "wrapper",
        title: "Wrapper",
        data: makeWrapperData(wrapper, [childA, childB]),
      }),
      makeSection({
        anchor: "p-a",
        kind: "wrapper-child",
        title: "Child A",
        parentTitle: "Wrapper",
        data: makeL1Data(childA),
      }),
      makeSection({
        anchor: "p-b",
        kind: "wrapper-child",
        title: "Child B",
        parentTitle: "Wrapper",
        data: makeL1Data(childB),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections.map((s) => s.anchor)).toEqual(["p-wrap", "p-b"]);
  });

  it("handles mix: 1 active wrapper + 1 hidden wrapper + 1 active standalone + 1 hidden standalone", () => {
    const wrapperA = makeProject({ id: "p-wrap-a", name: "Wrapper A" });
    const wrapperAChild = makeProject({
      id: "p-wa-child",
      parentProjectId: "p-wrap-a",
      status: "in-production",
    });
    const wrapperB = makeProject({ id: "p-wrap-b", name: "Wrapper B" });
    const wrapperBChild = makeProject({
      id: "p-wb-child",
      parentProjectId: "p-wrap-b",
      status: "completed",
    });
    const standaloneActive = makeProject({
      id: "p-sa",
      status: "in-production",
    });
    const standaloneDone = makeProject({ id: "p-sd", status: "completed" });

    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-wrap-a",
        kind: "wrapper",
        title: "Wrapper A",
        data: makeWrapperData(wrapperA, [wrapperAChild]),
      }),
      makeSection({
        anchor: "p-wa-child",
        kind: "wrapper-child",
        title: "WA Child",
        parentTitle: "Wrapper A",
        data: makeL1Data(wrapperAChild),
      }),
      makeSection({
        anchor: "p-wrap-b",
        kind: "wrapper",
        title: "Wrapper B",
        data: makeWrapperData(wrapperB, [wrapperBChild]),
      }),
      makeSection({
        anchor: "p-wb-child",
        kind: "wrapper-child",
        title: "WB Child",
        parentTitle: "Wrapper B",
        data: makeL1Data(wrapperBChild),
      }),
      makeSection({
        anchor: "p-sa",
        kind: "standalone",
        title: "Standalone Active",
        data: makeL1Data(standaloneActive),
      }),
      makeSection({
        anchor: "p-sd",
        kind: "standalone",
        title: "Standalone Done",
        data: makeL1Data(standaloneDone),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections.map((s) => s.anchor)).toEqual([
      "p-wrap-a",
      "p-wa-child",
      "p-sa",
    ]);
  });

  it("preserves section order through filtering", () => {
    const l1A = makeProject({ id: "p-a", status: "in-production" });
    const l1B = makeProject({ id: "p-b", status: "completed" });
    const l1C = makeProject({ id: "p-c", status: "blocked" });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-a",
        kind: "standalone",
        title: "A",
        data: makeL1Data(l1A),
      }),
      makeSection({
        anchor: "p-b",
        kind: "standalone",
        title: "B",
        data: makeL1Data(l1B),
      }),
      makeSection({
        anchor: "p-c",
        kind: "standalone",
        title: "C",
        data: makeL1Data(l1C),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections.map((s) => s.anchor)).toEqual(["p-a", "p-c"]);
  });

  it("drops wrapper-child sections whose parent wrapper is filtered out", () => {
    const wrapper = makeProject({ id: "p-wrap", name: "Wrapper" });
    const childA = makeProject({
      id: "p-a",
      parentProjectId: "p-wrap",
      status: "completed",
    });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-wrap",
        kind: "wrapper",
        title: "Wrapper",
        data: makeWrapperData(wrapper, [childA]),
      }),
      makeSection({
        anchor: "p-a",
        kind: "wrapper-child",
        title: "Child A",
        parentTitle: "Wrapper",
        data: makeL1Data(childA),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections).toEqual([]);
  });

  it("preserves all wrapper-child sections that belong to a kept wrapper", () => {
    const wrapper = makeProject({ id: "p-wrap", name: "Wrapper" });
    const activeChild = makeProject({
      id: "p-a",
      parentProjectId: "p-wrap",
      status: "in-production",
    });
    const otherActiveChild = makeProject({
      id: "p-b",
      parentProjectId: "p-wrap",
      status: "blocked",
    });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-wrap",
        kind: "wrapper",
        title: "Wrapper",
        data: makeWrapperData(wrapper, [activeChild, otherActiveChild]),
      }),
      makeSection({
        anchor: "p-a",
        kind: "wrapper-child",
        title: "A",
        parentTitle: "Wrapper",
        data: makeL1Data(activeChild),
      }),
      makeSection({
        anchor: "p-b",
        kind: "wrapper-child",
        title: "B",
        parentTitle: "Wrapper",
        data: makeL1Data(otherActiveChild),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections.map((s) => s.anchor)).toEqual([
      "p-wrap",
      "p-a",
      "p-b",
    ]);
  });

  it("conservatively keeps wrapper when it has any orphan weekItems (status not carried in rundown)", () => {
    const wrapper = makeProject({ id: "p-wrap", name: "Wrapper" });
    const child = makeProject({
      id: "p-c",
      parentProjectId: "p-wrap",
      status: "completed",
    });
    // Orphan presence (status not carried at rundown layer) → wrapper kept.
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-wrap",
        kind: "wrapper",
        title: "Wrapper",
        data: makeWrapperData(wrapper, [child], [
          { id: "w-orphan", title: "Stray" },
        ]),
      }),
      makeSection({
        anchor: "p-c",
        kind: "wrapper-child",
        title: "Child",
        parentTitle: "Wrapper",
        data: makeL1Data(child),
      }),
    ];
    const out = filterActiveRundown(makeRundown(sections));
    expect(out.sections.map((s) => s.anchor)).toEqual(["p-wrap"]);
  });

  it("does not mutate the input rundown", () => {
    const l1 = makeProject({ id: "p-l1", status: "completed" });
    const sections: RundownSection[] = [
      makeSection({
        anchor: "p-l1",
        kind: "standalone",
        title: "P",
        data: makeL1Data(l1),
      }),
    ];
    const rundown = makeRundown(sections);
    const originalSectionCount = rundown.sections.length;
    filterActiveRundown(rundown);
    expect(rundown.sections.length).toBe(originalSectionCount);
  });
});
