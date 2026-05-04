import { describe, expect, it } from "vitest";
import {
  detectAllIssues,
  detectChildProjectIssues,
  detectL1Issues,
  detectWeekItemIssues,
  detectWrapperIssues,
} from "./detect-issues";
import { transformRows } from "./transform-rows";
import type {
  ClientRow,
  IssueCode,
  ProjectRow,
  RawData,
  WeekItemRow,
} from "./types";

const NOW = new Date("2026-04-28T00:00:00Z");
const TODAY_ISO = "2026-04-28";

function makeClient(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: "c1",
    name: "Client",
    slug: "client",
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
    id: "p1",
    clientId: "c1",
    name: "Project",
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
    id: "w1",
    projectId: "p1",
    clientId: "c1",
    dayOfWeek: null,
    weekOf: null,
    date: null,
    startDate: null,
    endDate: null,
    blockedBy: null,
    title: "WeekItem",
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

function codes(issues: { code: IssueCode }[]): IssueCode[] {
  return issues.map((i) => i.code);
}

const fullRetainer = makeProject({
  id: "p-wrap",
  engagementType: "retainer",
  startDate: "2026-04-01",
  endDate: "2026-06-30",
  contractStart: "2026-04-01",
  contractEnd: "2026-06-30",
  category: "active",
  status: "in-production",
  owner: "Lane",
});

// ── detectChildProjectIssues ─────────────────────────────

describe("detectChildProjectIssues — inline date issues", () => {
  it("fires row-both-dates-null on null/null", () => {
    const c = makeProject({ startDate: null, endDate: null });
    expect(codes(detectChildProjectIssues(c, fullRetainer).inline)).toEqual([
      "row-both-dates-null",
    ]);
  });

  it("fires row-only-start-null", () => {
    const c = makeProject({ startDate: null, endDate: "2026-05-01" });
    expect(codes(detectChildProjectIssues(c, fullRetainer).inline)).toEqual([
      "row-only-start-null",
    ]);
  });

  it("fires row-only-end-null", () => {
    const c = makeProject({ startDate: "2026-05-01", endDate: null });
    expect(codes(detectChildProjectIssues(c, fullRetainer).inline)).toEqual([
      "row-only-end-null",
    ]);
  });

  it("fires row-end-before-start when end < start", () => {
    const c = makeProject({ startDate: "2026-05-10", endDate: "2026-05-01" });
    expect(codes(detectChildProjectIssues(c, fullRetainer).inline)).toEqual([
      "row-end-before-start",
    ]);
  });

  it("fires no inline issues for a normal range", () => {
    const c = makeProject({ startDate: "2026-05-01", endDate: "2026-05-10" });
    expect(detectChildProjectIssues(c, fullRetainer).inline).toEqual([]);
  });
});

describe("detectChildProjectIssues — sub-row issues", () => {
  const inRange = {
    startDate: "2026-05-01",
    endDate: "2026-05-15",
    parentProjectId: "p-wrap",
  };

  it("fires child-active-null-owner when category=active and owner is null", () => {
    const c = makeProject({ ...inRange, category: "active", owner: null });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-active-null-owner",
    );
  });

  it("does not fire child-active-null-owner when owner is set", () => {
    const c = makeProject({ ...inRange, category: "active", owner: "Lane" });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).not.toContain(
      "child-active-null-owner",
    );
  });

  it("fires child-orphan when parentProjectId is null", () => {
    const c = makeProject({ ...inRange, parentProjectId: null });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-orphan",
    );
  });

  it("fires child-parent-date-mismatch when child startDate is before wrapper", () => {
    const c = makeProject({
      startDate: "2026-03-01",
      endDate: "2026-04-15",
      parentProjectId: "p-wrap",
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-parent-date-mismatch",
    );
  });

  it("fires child-parent-date-mismatch when child endDate is after wrapper", () => {
    const c = makeProject({
      startDate: "2026-05-01",
      endDate: "2026-08-01",
      parentProjectId: "p-wrap",
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-parent-date-mismatch",
    );
  });

  it("does not fire child-parent-date-mismatch when wrapper has no range", () => {
    const noRangeWrapper = makeProject({
      id: "p-wrap",
      engagementType: "retainer",
      startDate: null,
      endDate: null,
      contractStart: null,
      contractEnd: null,
    });
    const c = makeProject({
      startDate: "2026-03-01",
      endDate: "2026-04-15",
      parentProjectId: "p-wrap",
    });
    expect(codes(detectChildProjectIssues(c, noRangeWrapper).subRow)).not.toContain(
      "child-parent-date-mismatch",
    );
  });

  it("derives wrapper range from contract dates when entity dates are null", () => {
    const contractOnly = makeProject({
      id: "p-wrap",
      engagementType: "retainer",
      startDate: null,
      endDate: null,
      contractStart: "2026-04-01",
      contractEnd: "2026-06-30",
    });
    const c = makeProject({
      startDate: "2026-08-01",
      endDate: "2026-08-15",
      parentProjectId: "p-wrap",
    });
    expect(codes(detectChildProjectIssues(c, contractOnly).subRow)).toContain(
      "child-parent-date-mismatch",
    );
  });

  it("fires child-end-before-start when end < start", () => {
    const c = makeProject({ startDate: "2026-05-10", endDate: "2026-05-01", parentProjectId: "p-wrap" });
    const subRowCodes = codes(detectChildProjectIssues(c, fullRetainer).subRow);
    expect(subRowCodes).toContain("child-end-before-start");
  });

  it("fires child-status-category-mismatch (status=completed, category=active)", () => {
    const c = makeProject({
      ...inRange,
      status: "completed",
      category: "active",
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-status-category-mismatch",
    );
  });

  it("fires child-status-category-mismatch (status=canceled, category=active)", () => {
    const c = makeProject({
      ...inRange,
      status: "canceled",
      category: "active",
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-status-category-mismatch",
    );
  });

  it("fires child-status-category-mismatch (status=on-hold, category=active)", () => {
    const c = makeProject({
      ...inRange,
      status: "on-hold",
      category: "active",
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-status-category-mismatch",
    );
  });

  it("does NOT fire child-status-category-mismatch for status=awaiting-client + category=active (legitimate combo)", () => {
    const c = makeProject({
      ...inRange,
      status: "awaiting-client",
      category: "active",
      waitingOn: "Client",
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).not.toContain(
      "child-status-category-mismatch",
    );
  });

  it("fires child-status-category-mismatch (category=completed, status=in-production)", () => {
    const c = makeProject({
      ...inRange,
      status: "in-production",
      category: "completed",
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-status-category-mismatch",
    );
  });

  it("fires child-awaiting-null-waiting-on", () => {
    const c = makeProject({
      ...inRange,
      status: "awaiting-client",
      waitingOn: null,
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-awaiting-null-waiting-on",
    );
  });

  it("does not fire child-awaiting-null-waiting-on when waitingOn is set", () => {
    const c = makeProject({
      ...inRange,
      status: "awaiting-client",
      waitingOn: "Client legal review",
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).not.toContain(
      "child-awaiting-null-waiting-on",
    );
  });

  it("fires child-null-engagement-when-parent-set", () => {
    const c = makeProject({
      ...inRange,
      engagementType: null,
    });
    expect(codes(detectChildProjectIssues(c, fullRetainer).subRow)).toContain(
      "child-null-engagement-when-parent-set",
    );
  });

  it("returns empty subRow for a clean child", () => {
    const c = makeProject({
      ...inRange,
      owner: "Lane",
      status: "in-production",
      category: "active",
      engagementType: "project",
    });
    expect(detectChildProjectIssues(c, fullRetainer).subRow).toEqual([]);
  });
});

// ── detectWeekItemIssues ─────────────────────────────────

const parentL1 = makeProject({
  id: "p-l1",
  startDate: "2026-04-01",
  endDate: "2026-06-30",
});

describe("detectWeekItemIssues — inline date issues", () => {
  it.each([
    [{ startDate: null, endDate: null }, "wi-both-dates-null"],
    [{ startDate: null, endDate: "2026-05-01" }, "wi-only-start-null"],
    [{ startDate: "2026-05-01", endDate: null }, "wi-only-end-null"],
    [{ startDate: "2026-05-10", endDate: "2026-05-01" }, "wi-end-before-start"],
  ])("fires %o → %s", (overrides, expected) => {
    const w = makeWeekItem(overrides);
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).inline)).toEqual([
      expected,
    ]);
  });

  it("returns empty inline for a normal range", () => {
    const w = makeWeekItem({ startDate: "2026-05-01", endDate: "2026-05-10" });
    expect(detectWeekItemIssues(w, parentL1, TODAY_ISO).inline).toEqual([]);
  });
});

describe("detectWeekItemIssues — sub-row issues", () => {
  it("fires wi-active-null-owner when status is in-progress and owner null", () => {
    const w = makeWeekItem({
      startDate: "2026-05-01",
      endDate: "2026-05-10",
      status: "in-progress",
      owner: null,
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).toContain(
      "wi-active-null-owner",
    );
  });

  it("fires wi-active-null-owner when status is null (treated as scheduled)", () => {
    const w = makeWeekItem({
      startDate: "2026-05-01",
      endDate: "2026-05-10",
      status: null,
      owner: null,
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).toContain(
      "wi-active-null-owner",
    );
  });

  it("does not fire wi-active-null-owner for terminal statuses", () => {
    const w = makeWeekItem({
      startDate: "2026-05-01",
      endDate: "2026-05-10",
      status: "completed",
      owner: null,
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-active-null-owner",
    );
  });

  it("fires wi-overdue when endDate is in the past and status is non-terminal", () => {
    const w = makeWeekItem({
      startDate: "2026-04-01",
      endDate: "2026-04-15",
      status: "in-progress",
      owner: "Lane",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).toContain(
      "wi-overdue",
    );
  });

  it("does not fire wi-overdue when status is completed", () => {
    const w = makeWeekItem({
      startDate: "2026-04-01",
      endDate: "2026-04-15",
      status: "completed",
      owner: "Lane",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-overdue",
    );
  });

  it("fires wi-outside-parent-range when item starts before parent", () => {
    const w = makeWeekItem({
      startDate: "2026-03-01",
      endDate: "2026-04-15",
      owner: "Lane",
      status: "in-progress",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).toContain(
      "wi-outside-parent-range",
    );
  });

  it("does not fire wi-outside-parent-range when parent has no dates", () => {
    const noDateParent = makeProject({ id: "p-l1", startDate: null, endDate: null });
    const w = makeWeekItem({
      startDate: "2026-03-01",
      endDate: "2026-04-15",
      owner: "Lane",
      status: "in-progress",
    });
    expect(codes(detectWeekItemIssues(w, noDateParent, TODAY_ISO).subRow)).not.toContain(
      "wi-outside-parent-range",
    );
  });

  it("combines inline + sub-row issues independently", () => {
    const w = makeWeekItem({
      startDate: "2026-05-10",
      endDate: "2026-05-01",
      status: "in-progress",
      owner: null,
    });
    const result = detectWeekItemIssues(w, parentL1, TODAY_ISO);
    expect(codes(result.inline)).toEqual(["wi-end-before-start"]);
    expect(codes(result.subRow)).toContain("wi-active-null-owner");
  });

  // ── New detectors (data-TP-driven) ──────────────────────

  // Convention reference: docs/runway-data-integrity-intent.md lines 17-20.
  // dayOfWeek + weekOf both track `date`, NOT `startDate`. On multi-day
  // items, `date == endDate ≠ startDate` — anchoring on startDate produces
  // false positives that were caught by the data TP on 2026-04-29 (LPPC
  // Website Revamp: R3, Pencils Down, QA Phase, Policy Materials Import).

  it("fires wi-day-of-week-mismatch when dayOfWeek doesn't match date's day", () => {
    // 2026-05-04 is a Monday, not Friday
    const w = makeWeekItem({
      date: "2026-05-04",
      startDate: "2026-05-04",
      endDate: "2026-05-04",
      dayOfWeek: "friday",
      owner: "Lane",
      status: "scheduled",
    });
    const result = detectWeekItemIssues(w, parentL1, TODAY_ISO);
    expect(codes(result.subRow)).toContain("wi-day-of-week-mismatch");
    const issue = result.subRow.find((i) => i.code === "wi-day-of-week-mismatch");
    expect(issue?.message).toContain("monday");
  });

  it("does NOT fire wi-day-of-week-mismatch on a multi-day item where dayOfWeek matches date", () => {
    // Regression: detector anchored on startDate would flag this as
    // "thursday doesn't match 2026-04-20 (monday)". The truth: dayOfWeek
    // tracks date (4/23 == Thursday).
    const w = makeWeekItem({
      date: "2026-04-23", // Thursday
      startDate: "2026-04-20", // Monday
      endDate: "2026-04-23",
      dayOfWeek: "thursday",
      owner: "Lane",
      status: "scheduled",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-day-of-week-mismatch",
    );
  });

  it("does not fire wi-day-of-week-mismatch when dayOfWeek is correct on a single-day item", () => {
    const w = makeWeekItem({
      date: "2026-05-04",
      startDate: "2026-05-04",
      endDate: "2026-05-04",
      dayOfWeek: "monday",
      owner: "Lane",
      status: "scheduled",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-day-of-week-mismatch",
    );
  });

  it("does not fire wi-day-of-week-mismatch when dayOfWeek is null (no claim to check)", () => {
    const w = makeWeekItem({
      date: "2026-05-04",
      startDate: "2026-05-04",
      endDate: "2026-05-04",
      dayOfWeek: null,
      owner: "Lane",
      status: "scheduled",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-day-of-week-mismatch",
    );
  });

  it("does not fire wi-day-of-week-mismatch when date is null (no anchor)", () => {
    // Convention is anchored on `date`. If date is null we have no truth
    // to compare against — skip silently rather than fall back to startDate.
    const w = makeWeekItem({
      date: null,
      startDate: "2026-04-20",
      endDate: "2026-04-23",
      dayOfWeek: "thursday",
      owner: "Lane",
      status: "scheduled",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-day-of-week-mismatch",
    );
  });

  it("fires wi-week-of-stale when weekOf isn't Monday-of-week for date", () => {
    const w = makeWeekItem({
      date: "2026-05-07", // Thursday — Monday is 5/4
      startDate: "2026-05-07",
      endDate: "2026-05-07",
      weekOf: "2026-04-27", // wrong; should be 2026-05-04
      owner: "Lane",
      status: "scheduled",
    });
    const result = detectWeekItemIssues(w, parentL1, TODAY_ISO);
    expect(codes(result.subRow)).toContain("wi-week-of-stale");
    const issue = result.subRow.find((i) => i.code === "wi-week-of-stale");
    expect(issue?.message).toContain("expected 2026-05-04");
  });

  it("does NOT fire wi-week-of-stale on a multi-day item where weekOf matches date's Monday", () => {
    // Regression: detector anchored on startDate would flag Pencils Down
    // (date=5/4 Mon, startDate=4/23 Thu, weekOf=2026-05-04) because Monday
    // of startDate's week is 4/20. Truth: weekOf tracks date.
    const w = makeWeekItem({
      date: "2026-05-04",
      startDate: "2026-04-23",
      endDate: "2026-05-04",
      weekOf: "2026-05-04",
      owner: "Lane",
      status: "scheduled",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-week-of-stale",
    );
  });

  it("does not fire wi-week-of-stale when weekOf is the correct Monday on a single-day item", () => {
    const w = makeWeekItem({
      date: "2026-05-07",
      startDate: "2026-05-07",
      endDate: "2026-05-07",
      weekOf: "2026-05-04",
      owner: "Lane",
      status: "scheduled",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-week-of-stale",
    );
  });

  it("fires wi-empty-string-status when status is the literal empty string", () => {
    const w = makeWeekItem({
      startDate: "2026-05-04",
      endDate: "2026-05-04",
      status: "",
      owner: "Lane",
    });
    const result = detectWeekItemIssues(w, parentL1, TODAY_ISO);
    expect(codes(result.subRow)).toContain("wi-empty-string-status");
    const issue = result.subRow.find((i) => i.code === "wi-empty-string-status");
    expect(issue?.severity).toBe("critical");
  });

  it("does not fire wi-empty-string-status when status is null (legacy default)", () => {
    const w = makeWeekItem({ status: null, owner: "Lane" });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-empty-string-status",
    );
  });

  it("fires wi-empty-string-resources when resources is the literal empty string", () => {
    const w = makeWeekItem({
      startDate: "2026-05-04",
      endDate: "2026-05-04",
      resources: "",
      owner: "Lane",
      status: "scheduled",
    });
    const result = detectWeekItemIssues(w, parentL1, TODAY_ISO);
    expect(codes(result.subRow)).toContain("wi-empty-string-resources");
    expect(
      result.subRow.find((i) => i.code === "wi-empty-string-resources")?.severity,
    ).toBe("critical");
  });

  it("does not fire wi-empty-string-resources when resources is null", () => {
    const w = makeWeekItem({ resources: null, owner: "Lane" });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-empty-string-resources",
    );
  });

  it("fires wi-bare-resource-name when a resource segment lacks a 'Role:' prefix", () => {
    const w = makeWeekItem({
      startDate: "2026-05-04",
      endDate: "2026-05-04",
      resources: "Kathy", // bare name — no role prefix
      owner: "Lane",
      status: "scheduled",
    });
    const result = detectWeekItemIssues(w, parentL1, TODAY_ISO);
    expect(codes(result.subRow)).toContain("wi-bare-resource-name");
    expect(
      result.subRow.find((i) => i.code === "wi-bare-resource-name")?.severity,
    ).toBe("info");
  });

  it("does not fire wi-bare-resource-name on a properly prefixed resources string", () => {
    const w = makeWeekItem({
      startDate: "2026-05-04",
      endDate: "2026-05-04",
      resources: "AM: Kathy, CW: Lane",
      owner: "Lane",
      status: "scheduled",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).not.toContain(
      "wi-bare-resource-name",
    );
  });

  it("flags only the bare segment when prefixed and bare are mixed", () => {
    const w = makeWeekItem({
      startDate: "2026-05-04",
      endDate: "2026-05-04",
      resources: "AM: Kathy, Chris", // Chris is bare
      owner: "Lane",
      status: "scheduled",
    });
    expect(codes(detectWeekItemIssues(w, parentL1, TODAY_ISO).subRow)).toContain(
      "wi-bare-resource-name",
    );
  });

  it("does not fire wi-bare-resource-name when resources is empty string (other rule fires)", () => {
    const w = makeWeekItem({
      startDate: "2026-05-04",
      endDate: "2026-05-04",
      resources: "",
      owner: "Lane",
      status: "scheduled",
    });
    const result = detectWeekItemIssues(w, parentL1, TODAY_ISO);
    expect(codes(result.subRow)).toContain("wi-empty-string-resources");
    expect(codes(result.subRow)).not.toContain("wi-bare-resource-name");
  });
});

// ── detectL1Issues ───────────────────────────────────────

describe("detectL1Issues", () => {
  const cleanL1 = makeProject({
    id: "p-clean",
    name: "Clean L1",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    dueDate: "2026-06-30",
    engagementType: "project",
    category: "active",
    status: "in-production",
    owner: "Lane",
  });

  it("fires no issues for a fully-populated L1 with weekItems", () => {
    expect(detectL1Issues(cleanL1, 5)).toEqual([]);
  });

  it("fires l1-null-dates when startDate is null", () => {
    const e = makeProject({ ...cleanL1, startDate: null });
    expect(codes(detectL1Issues(e, 5))).toContain("l1-null-dates");
  });

  it("fires l1-retainer-null-contract when retainer with null contractStart", () => {
    const e = makeProject({
      ...cleanL1,
      engagementType: "retainer",
      contractStart: null,
      contractEnd: "2026-06-30",
    });
    expect(codes(detectL1Issues(e, 5))).toContain("l1-retainer-null-contract");
  });

  it("does not fire l1-retainer-null-contract for non-retainer engagement", () => {
    const e = makeProject({ ...cleanL1, engagementType: "project", contractStart: null });
    expect(codes(detectL1Issues(e, 5))).not.toContain("l1-retainer-null-contract");
  });

  it("fires l1-null-engagement-type for null engagementType", () => {
    const e = makeProject({ ...cleanL1, engagementType: null });
    expect(codes(detectL1Issues(e, 5))).toContain("l1-null-engagement-type");
  });

  it("fires l1-bad-engagement-type for invalid value (e.g. break-fix)", () => {
    // Split from l1-null-engagement-type: null is a fillable gap (warn);
    // an invalid set value is a schema violation (critical).
    const e = makeProject({ ...cleanL1, engagementType: "break-fix" });
    const result = detectL1Issues(e, 5);
    expect(codes(result)).toContain("l1-bad-engagement-type");
    expect(codes(result)).not.toContain("l1-null-engagement-type");
    const issue = result.find((i) => i.code === "l1-bad-engagement-type");
    expect(issue?.message).toContain("break-fix");
    expect(issue?.severity).toBe("critical");
  });

  it("fires l1-empty-string-due-date when dueDate is the literal empty string", () => {
    const e = makeProject({ ...cleanL1, dueDate: "" });
    const result = detectL1Issues(e, 5);
    expect(codes(result)).toContain("l1-empty-string-due-date");
    const issue = result.find((i) => i.code === "l1-empty-string-due-date");
    expect(issue?.severity).toBe("critical");
  });

  it("does not fire l1-empty-string-due-date when dueDate is null (the desired state)", () => {
    const e = makeProject({ ...cleanL1, dueDate: null });
    expect(codes(detectL1Issues(e, 5))).not.toContain("l1-empty-string-due-date");
  });

  it("fires l1-null-category-or-status when both null", () => {
    const e = makeProject({ ...cleanL1, category: null, status: null });
    expect(codes(detectL1Issues(e, 5))).toContain("l1-null-category-or-status");
  });

  it("fires l1-awaiting-null-waiting-on", () => {
    const e = makeProject({ ...cleanL1, status: "awaiting-client", waitingOn: null });
    expect(codes(detectL1Issues(e, 5))).toContain("l1-awaiting-null-waiting-on");
  });

  it("fires l1-due-end-mismatch when both are set but disagree", () => {
    const e = makeProject({ ...cleanL1, dueDate: "2026-06-15", endDate: "2026-06-30" });
    expect(codes(detectL1Issues(e, 5))).toContain("l1-due-end-mismatch");
  });

  it("does not fire l1-due-end-mismatch when only endDate is set (canonical case)", () => {
    // endDate is the canonical end-of-project value; dueDate is reserved for
    // milestones. Most projects have endDate-only — that is NOT a mismatch.
    const e = makeProject({ ...cleanL1, endDate: "2026-06-30", dueDate: null });
    expect(codes(detectL1Issues(e, 5))).not.toContain("l1-due-end-mismatch");
  });

  it("does not fire l1-due-end-mismatch when only dueDate is set", () => {
    const e = makeProject({ ...cleanL1, dueDate: "2026-06-30", endDate: null });
    expect(codes(detectL1Issues(e, 5))).not.toContain("l1-due-end-mismatch");
  });

  it("does not fire l1-due-end-mismatch when both are null", () => {
    const e = makeProject({ ...cleanL1, dueDate: null, endDate: null });
    expect(codes(detectL1Issues(e, 5))).not.toContain("l1-due-end-mismatch");
  });

  it("does not fire l1-due-end-mismatch when both are set and equal", () => {
    const e = makeProject({ ...cleanL1, dueDate: "2026-06-30", endDate: "2026-06-30" });
    expect(codes(detectL1Issues(e, 5))).not.toContain("l1-due-end-mismatch");
  });

  it("fires l1-no-weekitems-no-owner when weekItemCount=0 and owner is null", () => {
    const e = makeProject({ ...cleanL1, owner: null });
    expect(codes(detectL1Issues(e, 0))).toContain("l1-no-weekitems-no-owner");
  });

  it("does not fire l1-no-weekitems-no-owner when owner is set even with 0 weekItems", () => {
    expect(codes(detectL1Issues(cleanL1, 0))).not.toContain("l1-no-weekitems-no-owner");
  });
});

// ── detectWrapperIssues ──────────────────────────────────

describe("detectWrapperIssues", () => {
  const cleanWrapper = makeProject({
    id: "p-wrap",
    name: "Wrapper",
    engagementType: "retainer",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    contractStart: "2026-04-01",
    contractEnd: "2026-06-30",
  });

  function child(overrides: Partial<ProjectRow> = {}): ProjectRow {
    return makeProject({
      id: "p-c",
      parentProjectId: "p-wrap",
      startDate: "2026-04-15",
      endDate: "2026-05-15",
      contractStart: "2026-04-01",
      contractEnd: "2026-06-30",
      ...overrides,
    });
  }

  it("fires no issues for a clean wrapper with in-range children", () => {
    expect(detectWrapperIssues(cleanWrapper, [child()], [])).toEqual([]);
  });

  it("fires wrapper-null-contract", () => {
    const w = makeProject({ ...cleanWrapper, contractStart: null });
    expect(codes(detectWrapperIssues(w, [child()], []))).toContain("wrapper-null-contract");
  });

  it("fires wrapper-no-children when children list is empty", () => {
    expect(codes(detectWrapperIssues(cleanWrapper, [], []))).toContain("wrapper-no-children");
  });

  it("fires wrapper-bad-engagement-type for non-retainer", () => {
    const w = makeProject({ ...cleanWrapper, engagementType: "project" });
    expect(codes(detectWrapperIssues(w, [child()], []))).toContain("wrapper-bad-engagement-type");
  });

  it("fires wrapper-range-misses-children when child startDate is before wrapper", () => {
    const c = child({ startDate: "2026-03-01" });
    const result = detectWrapperIssues(cleanWrapper, [c], []);
    expect(codes(result)).toContain("wrapper-range-misses-children");
    const issue = result.find((i) => i.code === "wrapper-range-misses-children");
    expect(issue?.message).toMatch(/starts 2026-03-01/);
  });

  it("fires wrapper-child-contract-mismatch when child contract dates differ", () => {
    const c = child({ contractStart: "2026-01-01" });
    expect(codes(detectWrapperIssues(cleanWrapper, [c], []))).toContain(
      "wrapper-child-contract-mismatch",
    );
  });

  it("fires wrapper-has-orphan-weekitems with id list when orphans exist", () => {
    const orphans = [
      { id: "w-o1", title: "Stray Item" },
      { id: "w-o2", title: "Another Stray" },
    ];
    const result = detectWrapperIssues(cleanWrapper, [child()], orphans);
    expect(codes(result)).toContain("wrapper-has-orphan-weekitems");
    const issue = result.find((i) => i.code === "wrapper-has-orphan-weekitems");
    expect(issue?.message).toContain("w-o1 (Stray Item)");
    expect(issue?.message).toContain("w-o2 (Another Stray)");
    expect(issue?.message).toContain("only child project rows are rendered");
    // Plural noun for count > 1, no "(s)" fallback.
    expect(issue?.message).toContain("2 weekItems attached");
    expect(issue?.message).not.toContain("(s)");
  });

  it("uses singular noun when there is exactly 1 orphan weekItem", () => {
    const result = detectWrapperIssues(
      cleanWrapper,
      [child()],
      [{ id: "w-only", title: "Lone" }],
    );
    const issue = result.find((i) => i.code === "wrapper-has-orphan-weekitems");
    expect(issue?.message).toContain("1 weekItem attached");
    expect(issue?.message).not.toContain("weekItems attached");
    expect(issue?.message).not.toContain("(s)");
  });

  it("does not fire wrapper-has-orphan-weekitems when orphans list is empty", () => {
    expect(codes(detectWrapperIssues(cleanWrapper, [child()], []))).not.toContain(
      "wrapper-has-orphan-weekitems",
    );
  });

  it("fires wrapper-null-dates when wrapper has children but its own startDate is null", () => {
    const w = makeProject({ ...cleanWrapper, startDate: null });
    const result = detectWrapperIssues(w, [child()], []);
    expect(codes(result)).toContain("wrapper-null-dates");
    const issue = result.find((i) => i.code === "wrapper-null-dates");
    expect(issue?.severity).toBe("critical");
    expect(issue?.message).toContain("startDate");
    expect(issue?.message).toContain("bypassGuard");
  });

  it("does NOT fire wrapper-null-dates when wrapper has no children (degenerate retainer)", () => {
    const w = makeProject({ ...cleanWrapper, startDate: null, endDate: null });
    expect(codes(detectWrapperIssues(w, [], []))).not.toContain("wrapper-null-dates");
  });
});

// ── detectAllIssues dispatcher ───────────────────────────

const client = makeClient();

describe("detectAllIssues", () => {
  it("routes wrapper raw to wrapper detectors", () => {
    const wrapper = makeProject({
      id: "p-wrap",
      engagementType: "retainer",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      contractStart: "2026-04-01",
      contractEnd: "2026-06-30",
    });
    const childA = makeProject({
      id: "p-a",
      name: "Child A",
      parentProjectId: "p-wrap",
      startDate: "2026-04-15",
      endDate: "2026-05-15",
      contractStart: "2026-04-01",
      contractEnd: "2026-06-30",
      category: "active",
      owner: null, // → child-active-null-owner
    });
    const raw: RawData = {
      kind: "wrapper",
      entity: wrapper,
      client,
      children: [childA],
      orphanWeekItems: [{ id: "w-o", title: "Stray" }],
    };
    const rows = transformRows(raw);
    const out = detectAllIssues(raw, rows, NOW);
    expect(codes(out.chartIssues)).toContain("wrapper-has-orphan-weekitems");
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].kind).toBe("project");
    expect(codes(out.rows[0].subRow)).toContain("child-active-null-owner");
  });

  it("routes l1 raw to L1 detectors and weekItem detector", () => {
    const project = makeProject({
      id: "p-l1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      dueDate: "2026-06-15", // disagrees with endDate → l1-due-end-mismatch
      engagementType: "project",
      category: "active",
      status: "in-production",
      owner: "Lane",
    });
    const w = makeWeekItem({
      id: "w-1",
      projectId: "p-l1",
      startDate: "2026-04-15",
      endDate: "2026-04-20",
      status: "in-progress",
      owner: null, // → wi-active-null-owner
    });
    const raw: RawData = { kind: "l1", entity: project, client, children: [w] };
    const rows = transformRows(raw);
    const out = detectAllIssues(raw, rows, NOW);
    expect(codes(out.chartIssues)).toContain("l1-due-end-mismatch");
    expect(out.rows[0].kind).toBe("weekitem");
    expect(codes(out.rows[0].subRow)).toContain("wi-active-null-owner");
  });

  it("populates empty issue arrays on rows even when nothing fires", () => {
    const project = makeProject({
      id: "p-l1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      engagementType: "project",
      category: "active",
      status: "in-production",
      owner: "Lane",
      dueDate: "2026-06-30",
    });
    const w = makeWeekItem({
      id: "w-1",
      projectId: "p-l1",
      startDate: "2026-05-15",
      endDate: "2026-05-20", // future relative to NOW (2026-04-28) — avoids wi-overdue
      status: "in-progress",
      owner: "Lane",
    });
    const raw: RawData = { kind: "l1", entity: project, client, children: [w] };
    const rows = transformRows(raw);
    const out = detectAllIssues(raw, rows, NOW);
    expect(out.chartIssues).toEqual([]);
    expect(out.rows[0].inline).toEqual([]);
    expect(out.rows[0].subRow).toEqual([]);
  });
});
