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
        summary: `Convergix / CDS Messaging: owner changed from "Kathy" to "Lane"`,
        createdAt: new Date("2026-04-18T12:00:00Z"),
      }),
      makeRecord({
        id: "u2",
        updateType: "field-change",
        metadata: JSON.stringify({ field: "owner" }),
        previousValue: "Lane",
        newValue: "Jason",
        summary: `Convergix / CDS Messaging: owner changed from "Lane" to "Jason"`,
        createdAt: new Date("2026-04-18T12:01:00Z"),
      }),
    ];

    const draft = formatDraft(records, clientNames, projectNames);
    // Net change: Kathy → Jason (skips intermediate Lane)
    // Only the last summary survives (Lane → Jason) but previousValue is carried from first.
    expect(draft).toContain("Lane");
    expect(draft).toContain("Jason");
    // Should only have one bullet
    const bullets = draft.match(/^- /gm);
    expect(bullets).toHaveLength(1);
  });

  it("does NOT dedup distinct entities sharing the same (client, project, field)", () => {
    // Regression guard: under the old logic, two week-field-change rows with
    // the same `field` on different week items collapsed into one bullet.
    const records = [
      makeRecord({
        id: "u1",
        updateType: "week-field-change",
        projectId: null,
        metadata: JSON.stringify({ field: "title" }),
        previousValue: "Old A",
        newValue: "New A",
        summary: `Week item 'Old A': title changed from "Old A" to "New A"`,
        createdAt: new Date("2026-04-18T12:00:00Z"),
      }),
      makeRecord({
        id: "u2",
        updateType: "week-field-change",
        projectId: null,
        metadata: JSON.stringify({ field: "title" }),
        previousValue: "Old B",
        newValue: "New B",
        summary: `Week item 'Old B': title changed from "Old B" to "New B"`,
        createdAt: new Date("2026-04-18T12:01:00Z"),
      }),
    ];

    const draft = formatDraft(records, clientNames, projectNames);
    const bullets = draft.match(/^- /gm);
    expect(bullets).toHaveLength(2);
    expect(draft).toContain("Old A");
    expect(draft).toContain("Old B");
  });

  it("does NOT dedup non-field-change types like new-week-item / week-reparent / delete-project", () => {
    // Regression guard: under the old logic, multiple new-* / delete-* / reparent
    // rows with empty metadata.field collapsed into one bullet per (client, project).
    const records = [
      makeRecord({
        id: "u1",
        updateType: "new-week-item",
        projectId: null,
        summary: "New week item (Convergix): Item A",
        previousValue: null,
        newValue: "Item A",
        createdAt: new Date("2026-04-18T12:00:00Z"),
      }),
      makeRecord({
        id: "u2",
        updateType: "new-week-item",
        projectId: null,
        summary: "New week item (Convergix): Item B",
        previousValue: null,
        newValue: "Item B",
        createdAt: new Date("2026-04-18T12:01:00Z"),
      }),
      makeRecord({
        id: "u3",
        updateType: "week-reparent",
        projectId: "p1",
        summary: "Week item 'X': re-parented from (none) to CDS Messaging",
        previousValue: "(none)",
        newValue: "p1",
        createdAt: new Date("2026-04-18T12:02:00Z"),
      }),
      makeRecord({
        id: "u4",
        updateType: "week-reparent",
        projectId: "p1",
        summary: "Week item 'Y': re-parented from (none) to CDS Messaging",
        previousValue: "(none)",
        newValue: "p1",
        createdAt: new Date("2026-04-18T12:03:00Z"),
      }),
      makeRecord({
        id: "u5",
        updateType: "delete-project",
        projectId: null,
        summary: "Deleted project from Convergix: Proj A",
        previousValue: "Proj A",
        newValue: null,
        createdAt: new Date("2026-04-18T12:04:00Z"),
      }),
      makeRecord({
        id: "u6",
        updateType: "delete-project",
        projectId: null,
        summary: "Deleted project from Convergix: Proj B",
        previousValue: "Proj B",
        newValue: null,
        createdAt: new Date("2026-04-18T12:05:00Z"),
      }),
    ];

    const draft = formatDraft(records, clientNames, projectNames);
    const bullets = draft.match(/^- /gm);
    expect(bullets).toHaveLength(6);
    expect(draft).toContain("Item A");
    expect(draft).toContain("Item B");
    expect(draft).toContain("Week item 'X'");
    expect(draft).toContain("Week item 'Y'");
    expect(draft).toContain("Proj A");
    expect(draft).toContain("Proj B");
  });

  it("skips net no-ops", () => {
    const records = [
      makeRecord({
        id: "u1",
        updateType: "field-change",
        metadata: JSON.stringify({ field: "owner" }),
        previousValue: "Kathy",
        newValue: "Lane",
        summary: `Convergix / CDS Messaging: owner changed from "Kathy" to "Lane"`,
        createdAt: new Date("2026-04-18T12:00:00Z"),
      }),
      makeRecord({
        id: "u2",
        updateType: "field-change",
        metadata: JSON.stringify({ field: "owner" }),
        previousValue: "Lane",
        newValue: "Kathy",
        summary: `Convergix / CDS Messaging: owner changed from "Lane" to "Kathy"`,
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

// ── Regression: bonterra-cleanup-2026-04-19 batch ──────────────────────────
// The 25 audit rows from this batch were collapsed to 12 bullets under the old
// dedup logic, silently dropping 13 distinct rows (multiple new-week-item,
// week-reparent, delete-project rows shared the old dedup key, and
// week-field-change rows for different entities sharing a `field` collided).
// See docs/tmp/bonterra-publish-preview.md for the full analysis.
describe("formatDraft: bonterra-cleanup-2026-04-19 regression", () => {
  const CLIENT = "11fb1b5f90014a5dac1030d37";
  const IMPACT_REPORT_PROJ = "e4fc876e4e6341f3887f35474";

  const bonterraClientNames = new Map([[CLIENT, "Bonterra"]]);
  const bonterraProjectNames = new Map([[IMPACT_REPORT_PROJ, "Impact Report"]]);

  interface Row {
    id: string;
    clientId: string;
    projectId: string | null;
    updatedBy: string;
    updateType: string;
    previousValue: string | null;
    newValue: string | null;
    summary: string;
    metadata: string | null;
    batchId: string;
    createdAt: Date;
  }

  function row(overrides: Partial<Row>): Row {
    return {
      id: overrides.id!,
      clientId: CLIENT,
      projectId: null,
      updatedBy: "migration",
      updateType: overrides.updateType!,
      previousValue: null,
      newValue: null,
      summary: overrides.summary!,
      metadata: null,
      batchId: "bonterra-cleanup-2026-04-19",
      createdAt: overrides.createdAt!,
      ...overrides,
    };
  }

  const bonterraBatch: Row[] = [
    row({
      id: "r1",
      updateType: "new-week-item",
      summary: "New week item (Bonterra): Impact Report — Internal Review",
      newValue: "Impact Report — Internal Review",
      createdAt: new Date("2026-04-20T03:58:12.000Z"),
    }),
    row({
      id: "r2",
      updateType: "client-field-change",
      summary: `Bonterra: team changed from "" to "AM: Jill, CD: Lane, Dev: Leslie"`,
      previousValue: "",
      newValue: "AM: Jill, CD: Lane, Dev: Leslie",
      metadata: JSON.stringify({ field: "team" }),
      createdAt: new Date("2026-04-20T03:58:12.000Z"),
    }),
    row({
      id: "r3",
      projectId: IMPACT_REPORT_PROJ,
      updateType: "week-reparent",
      summary: "Week item 'Impact Report — Go Live': re-parented from (none) to Impact Report",
      previousValue: "(none)",
      newValue: IMPACT_REPORT_PROJ,
      createdAt: new Date("2026-04-20T03:58:11.000Z"),
    }),
    row({
      id: "r4",
      updateType: "new-week-item",
      summary: "New week item (Bonterra): Impact Report — Dev K/O",
      newValue: "Impact Report — Dev K/O",
      createdAt: new Date("2026-04-20T03:58:11.000Z"),
    }),
    row({
      id: "r5",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra Impact Report — Go Live': title changed from "Bonterra Impact Report — Go Live" to "Impact Report — Go Live"`,
      previousValue: "Bonterra Impact Report — Go Live",
      newValue: "Impact Report — Go Live",
      metadata: JSON.stringify({ field: "title" }),
      createdAt: new Date("2026-04-20T03:58:10.000Z"),
    }),
    row({
      id: "r6",
      projectId: IMPACT_REPORT_PROJ,
      updateType: "week-reparent",
      summary: "Week item 'Impact Report — Design Presentation': re-parented from (none) to Impact Report",
      previousValue: "(none)",
      newValue: IMPACT_REPORT_PROJ,
      createdAt: new Date("2026-04-20T03:58:10.000Z"),
    }),
    row({
      id: "r7",
      projectId: IMPACT_REPORT_PROJ,
      updateType: "week-reparent",
      summary: "Week item 'Impact Report — Design Approval': re-parented from (none) to Impact Report",
      previousValue: "(none)",
      newValue: IMPACT_REPORT_PROJ,
      createdAt: new Date("2026-04-20T03:58:10.000Z"),
    }),
    row({
      id: "r8",
      projectId: IMPACT_REPORT_PROJ,
      updateType: "week-reparent",
      summary: "Week item 'Impact Report — Dev Handoff': re-parented from (none) to Impact Report",
      previousValue: "(none)",
      newValue: IMPACT_REPORT_PROJ,
      createdAt: new Date("2026-04-20T03:58:10.000Z"),
    }),
    row({
      id: "r9",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra Impact Report — Go Live': resources changed from "Leslie" to "Bonterra"`,
      previousValue: "Leslie",
      newValue: "Bonterra",
      metadata: JSON.stringify({ field: "resources" }),
      createdAt: new Date("2026-04-20T03:58:09.000Z"),
    }),
    row({
      id: "r10",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra Impact Report — Go Live': category changed from "deadline" to "launch"`,
      previousValue: "deadline",
      newValue: "launch",
      metadata: JSON.stringify({ field: "category" }),
      createdAt: new Date("2026-04-20T03:58:09.000Z"),
    }),
    row({
      id: "r11",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra Impact Report — code handoff': dayOfWeek changed from "thursday" to "tuesday"`,
      previousValue: "thursday",
      newValue: "tuesday",
      metadata: JSON.stringify({ field: "dayOfWeek" }),
      createdAt: new Date("2026-04-20T03:58:08.000Z"),
    }),
    row({
      id: "r12",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra Impact Report — code handoff': resources changed from "Leslie" to "Dev: Leslie"`,
      previousValue: "Leslie",
      newValue: "Dev: Leslie",
      metadata: JSON.stringify({ field: "resources" }),
      createdAt: new Date("2026-04-20T03:58:08.000Z"),
    }),
    row({
      id: "r13",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra Impact Report — code handoff': weekOf changed from "2026-04-20" to "2026-04-27"`,
      previousValue: "2026-04-20",
      newValue: "2026-04-27",
      metadata: JSON.stringify({ field: "weekOf" }),
      createdAt: new Date("2026-04-20T03:58:08.000Z"),
    }),
    row({
      id: "r14",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra Impact Report — code handoff': title changed from "Bonterra Impact Report — code handoff" to "Impact Report — Dev Handoff"`,
      previousValue: "Bonterra Impact Report — code handoff",
      newValue: "Impact Report — Dev Handoff",
      metadata: JSON.stringify({ field: "title" }),
      createdAt: new Date("2026-04-20T03:58:08.000Z"),
    }),
    row({
      id: "r15",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra approval needed': resources changed from "Lane" to "CD: Lane"`,
      previousValue: "Lane",
      newValue: "CD: Lane",
      metadata: JSON.stringify({ field: "resources" }),
      createdAt: new Date("2026-04-20T03:58:07.000Z"),
    }),
    row({
      id: "r16",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra approval needed': title changed from "Bonterra approval needed" to "Impact Report — Design Approval"`,
      previousValue: "Bonterra approval needed",
      newValue: "Impact Report — Design Approval",
      metadata: JSON.stringify({ field: "title" }),
      createdAt: new Date("2026-04-20T03:58:07.000Z"),
    }),
    row({
      id: "r17",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra Impact Report — code handoff': date changed from "2026-04-23" to "2026-04-28"`,
      previousValue: "2026-04-23",
      newValue: "2026-04-28",
      metadata: JSON.stringify({ field: "date" }),
      createdAt: new Date("2026-04-20T03:58:07.000Z"),
    }),
    row({
      id: "r18",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra — Paige presenting designs': resources changed from "Lane" to "CD: Lane"`,
      previousValue: "Lane",
      newValue: "CD: Lane",
      metadata: JSON.stringify({ field: "resources" }),
      createdAt: new Date("2026-04-20T03:58:06.000Z"),
    }),
    row({
      id: "r19",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra — Paige presenting designs': title changed from "Bonterra — Paige presenting designs" to "Impact Report — Design Presentation"`,
      previousValue: "Bonterra — Paige presenting designs",
      newValue: "Impact Report — Design Presentation",
      metadata: JSON.stringify({ field: "title" }),
      createdAt: new Date("2026-04-20T03:58:06.000Z"),
    }),
    row({
      id: "r20",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra approval needed': status changed from "" to "completed"`,
      previousValue: "",
      newValue: "completed",
      metadata: JSON.stringify({ field: "status" }),
      createdAt: new Date("2026-04-20T03:58:06.000Z"),
    }),
    row({
      id: "r21",
      projectId: IMPACT_REPORT_PROJ,
      updateType: "new-item",
      summary: "New project added to Bonterra: Impact Report",
      newValue: "Impact Report",
      createdAt: new Date("2026-04-20T03:58:05.000Z"),
    }),
    row({
      id: "r22",
      updateType: "week-field-change",
      summary: `Week item 'Bonterra — Paige presenting designs': status changed from "" to "completed"`,
      previousValue: "",
      newValue: "completed",
      metadata: JSON.stringify({ field: "status" }),
      createdAt: new Date("2026-04-20T03:58:05.000Z"),
    }),
    row({
      id: "r23",
      updateType: "delete-project",
      summary: "Deleted project from Bonterra: Impact Report — Design",
      previousValue: "Impact Report — Design",
      createdAt: new Date("2026-04-20T03:58:04.000Z"),
    }),
    row({
      id: "r24",
      updateType: "delete-project",
      summary: "Deleted project from Bonterra: Impact Report — Dev",
      previousValue: "Impact Report — Dev",
      createdAt: new Date("2026-04-20T03:58:04.000Z"),
    }),
    row({
      id: "r25",
      updateType: "delete-project",
      summary: "Deleted project from Bonterra: Impact Report — Publish",
      previousValue: "Impact Report — Publish",
      createdAt: new Date("2026-04-20T03:58:04.000Z"),
    }),
  ];

  it("emits all 25 bullets — no two rows in this batch share (entity+field) so nothing should collapse", () => {
    // Expected: 25 bullets.
    // - 6 non-dedupable rows (1 new-week-item, 1 new-week-item, 4 week-reparent,
    //   1 new-item, 3 delete-project) = 10 (actually: new-week-item x2,
    //   week-reparent x4, new-item x1, delete-project x3 = 10)
    // - 15 field-change rows, each targeting a unique (entity, field) pair
    //   within this batch
    // Total: 10 + 15 = 25. This matches the raw row count because no legitimate
    // dedup opportunity exists in this batch.
    const draft = formatDraft(bonterraBatch, bonterraClientNames, bonterraProjectNames);
    const bullets = draft.match(/^- /gm);
    expect(bullets).toHaveLength(25);
    expect(draft).toContain("## Bonterra");

    // Spot-check: rows that the old dedup logic silently dropped must all appear.
    // The 3 new-week-items — Impact Report — Internal Review survived under old
    // logic; Dev K/O and any others were dropped.
    expect(draft).toContain("Impact Report — Internal Review");
    expect(draft).toContain("Impact Report — Dev K/O");

    // 4 week-reparent rows — only Go Live survived under old logic.
    expect(draft).toContain("'Impact Report — Go Live'");
    expect(draft).toContain("'Impact Report — Design Presentation'");
    expect(draft).toContain("'Impact Report — Design Approval'");
    expect(draft).toContain("'Impact Report — Dev Handoff'");

    // 3 delete-project rows — only Publish survived under old logic.
    expect(draft).toContain("Impact Report — Design");
    expect(draft).toContain("Impact Report — Dev");
    expect(draft).toContain("Impact Report — Publish");

    // 3 title changes on different week items — old logic collapsed them to 1.
    expect(draft).toContain(`'Bonterra Impact Report — Go Live': title`);
    expect(draft).toContain(`'Bonterra Impact Report — code handoff': title`);
    expect(draft).toContain(`'Bonterra approval needed': title`);
    expect(draft).toContain(`'Bonterra — Paige presenting designs': title`);

    // 3 resources changes on different week items — old logic collapsed them to 1.
    expect(draft).toContain(`'Bonterra Impact Report — Go Live': resources`);
    expect(draft).toContain(`'Bonterra Impact Report — code handoff': resources`);
    expect(draft).toContain(`'Bonterra approval needed': resources`);
    expect(draft).toContain(`'Bonterra — Paige presenting designs': resources`);

    // Status changes on 2 different week items.
    expect(draft).toContain(`'Bonterra approval needed': status`);
    expect(draft).toContain(`'Bonterra — Paige presenting designs': status`);
  });
});
