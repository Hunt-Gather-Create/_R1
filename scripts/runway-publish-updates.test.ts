import { describe, it, expect } from "vitest";
import { formatDraft } from "./runway-publish-updates";

const clientNames = new Map([
  ["c1", "Convergix"],
  ["c2", "Bonterra"],
]);

const projectNames = new Map([
  ["p1", "CDS Messaging"],
  ["p2", "Impact Report"],
]);

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    clientId: "c1",
    projectId: "p1",
    updatedBy: "migration",
    updateType: "field-change",
    previousValue: "old",
    newValue: "new",
    summary: null,
    metadata: null,
    batchId: "test-batch",
    createdAt: new Date("2026-04-18T12:00:00Z"),
    ...overrides,
  };
}

describe("formatDraft", () => {
  it("groups records by client", () => {
    const records = [
      makeRecord({ clientId: "c1", summary: "Updated CDS owner" }),
      makeRecord({ clientId: "c2", summary: "Updated Impact Report notes", id: "u2", projectId: "p2" }),
    ];

    const draft = formatDraft(records, clientNames, projectNames);
    expect(draft).toContain("## Convergix");
    expect(draft).toContain("## Bonterra");
    expect(draft).toContain("Updated CDS owner");
    expect(draft).toContain("Updated Impact Report notes");
  });

  it("puts null clientId records under Team / Global", () => {
    const records = [
      makeRecord({ clientId: null, projectId: null, summary: "Deactivated Ronan" }),
    ];

    const draft = formatDraft(records, clientNames, projectNames);
    expect(draft).toContain("## Team / Global");
    expect(draft).toContain("Deactivated Ronan");
  });

  it("deduplicates to net change for same entity+field", () => {
    const records = [
      makeRecord({
        id: "u1",
        updateType: "field-change",
        metadata: JSON.stringify({ field: "owner" }),
        previousValue: "Kathy",
        newValue: "Lane",
        createdAt: new Date("2026-04-18T12:00:00Z"),
      }),
      makeRecord({
        id: "u2",
        updateType: "field-change",
        metadata: JSON.stringify({ field: "owner" }),
        previousValue: "Lane",
        newValue: "Jason",
        createdAt: new Date("2026-04-18T12:01:00Z"),
      }),
    ];

    const draft = formatDraft(records, clientNames, projectNames);
    // Net change: Kathy → Jason (skips intermediate Lane)
    expect(draft).toContain("Kathy");
    expect(draft).toContain("Jason");
    // Should only have one bullet
    const bullets = draft.match(/^- /gm);
    expect(bullets).toHaveLength(1);
  });

  it("skips net no-ops", () => {
    const records = [
      makeRecord({
        id: "u1",
        updateType: "field-change",
        metadata: JSON.stringify({ field: "owner" }),
        previousValue: "Kathy",
        newValue: "Lane",
        createdAt: new Date("2026-04-18T12:00:00Z"),
      }),
      makeRecord({
        id: "u2",
        updateType: "field-change",
        metadata: JSON.stringify({ field: "owner" }),
        previousValue: "Lane",
        newValue: "Kathy",
        createdAt: new Date("2026-04-18T12:01:00Z"),
      }),
    ];

    const draft = formatDraft(records, clientNames, projectNames);
    // Net no-op: Kathy → Lane → Kathy — should be skipped
    const bullets = draft.match(/^- /gm);
    expect(bullets).toBeNull();
  });

  it("uses summary when available", () => {
    const records = [
      makeRecord({ summary: "Deleted project Brand Refresh" }),
    ];

    const draft = formatDraft(records, clientNames, projectNames);
    expect(draft).toContain("Deleted project Brand Refresh");
  });

  it("falls back to updateType + values when no summary", () => {
    const records = [
      makeRecord({ summary: null, previousValue: "old", newValue: "new", updateType: "field-change" }),
    ];

    const draft = formatDraft(records, clientNames, projectNames);
    expect(draft).toContain("old → new");
  });
});
