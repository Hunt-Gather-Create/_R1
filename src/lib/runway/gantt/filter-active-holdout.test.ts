/**
 * Holdout QA tests for filter-active.ts (dashboard-cleanup items 6, 7, 9).
 * Focus: boundary values, null handling, state transitions the implementer
 * did not explicitly verify.
 */
import { describe, it, expect } from "vitest";
import { isReadyToClose, isL1Hidden, isWrapperHidden } from "./filter-active";
import type { ProjectRow, WeekItemRow } from "./types";

const NOW = new Date("2026-05-07T00:00:00Z");

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

describe("isReadyToClose holdout: boundary values + null data (item 9 Branch B)", () => {
  it("endDate exactly = today is NOT past (boundary: strict less-than)", () => {
    const l1 = makeProject({ status: "not-started", endDate: "2026-05-07" });
    expect(isReadyToClose(l1, [], "2026-05-07")).toBe(false);
  });

  it("endDate one day before today IS past", () => {
    const l1 = makeProject({ status: "not-started", endDate: "2026-05-06" });
    expect(isReadyToClose(l1, [], "2026-05-07")).toBe(true);
  });

  it("status null + no weekItems + past endDate -> fires (null is non-terminal)", () => {
    const l1 = makeProject({ status: null, endDate: "2026-05-01" });
    expect(isReadyToClose(l1, [], "2026-05-07")).toBe(true);
  });

  it("status null + no weekItems + future endDate -> does NOT fire", () => {
    const l1 = makeProject({ status: null, endDate: "2026-12-31" });
    expect(isReadyToClose(l1, [], "2026-05-07")).toBe(false);
  });

  it("0 weekItems + past endDate + awaiting-client status (non-terminal) -> fires", () => {
    const l1 = makeProject({ status: "awaiting-client", endDate: "2026-04-01" });
    expect(isReadyToClose(l1, [], "2026-05-07")).toBe(true);
  });

  it("0 weekItems + past endDate + on-hold status (non-terminal) -> fires", () => {
    const l1 = makeProject({ status: "on-hold", endDate: "2026-04-01" });
    expect(isReadyToClose(l1, [], "2026-05-07")).toBe(true);
  });

  it("uses todayISO if provided, not system clock", () => {
    const l1 = makeProject({ status: "not-started", endDate: "2026-05-06" });
    // Pass a different todayISO to prove it's not using new Date()
    expect(isReadyToClose(l1, [], "2026-05-05")).toBe(false); // endDate >= today
    expect(isReadyToClose(l1, [], "2026-05-07")).toBe(true);  // endDate < today
  });
});

describe("isL1Hidden holdout: null + unknown status edge cases", () => {
  it("returns false when status is empty string (not a known terminal)", () => {
    const l1 = makeProject({ status: "" });
    expect(isL1Hidden(l1)).toBe(false);
  });
});

describe("isWrapperHidden holdout: degenerate + mixed terminal edge cases", () => {
  const wrapper = makeProject({ id: "p-wrap" });

  it("returns false for wrapper with only 1 child that is null status (non-terminal)", () => {
    const kid = makeProject({ id: "k1", status: null });
    expect(isWrapperHidden(wrapper, [kid], [])).toBe(false);
  });

  it("all-completed kids + empty-string status orphan (non-terminal orphan) -> not hidden", () => {
    const kid = makeProject({ id: "k1", status: "completed" });
    const orphan = makeWeekItem({ id: "w1", status: "" });
    // empty string is falsy -> acts as non-terminal (wi.status != null is false for "")
    // but "" != null is TRUE -- "" is not null. However TERMINAL_STATUSES.has("") = false.
    // So the orphan would keep the wrapper visible. Let's verify.
    expect(isWrapperHidden(wrapper, [kid], [orphan])).toBe(false);
  });
});
