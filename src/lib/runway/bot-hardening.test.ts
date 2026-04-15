/**
 * Bot Hardening — Integration Tests
 *
 * Exercises the operations layer against a real in-memory SQLite database.
 * Only mock: @/lib/db/runway (to inject the test DB).
 * All other modules (operations-utils, operations-writes, etc.) run for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  getProject,
  getWeekItem,
  getAuditRecords,
  type TestDb,
} from "./test-db";

// ── Mock setup ──────────────────────────────────────────

let testDb: TestDb;
let rawClient: Client;
let dbPath: string;

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

beforeEach(async () => {
  const result = await createTestDb();
  rawClient = result.client;
  testDb = result.db;
  dbPath = result.dbPath;
  await seedTestDb(rawClient);

  // Reset the client cache between tests
  const { _resetClientCacheForTest } = await import("./operations-utils");
  _resetClientCacheForTest();
});

afterEach(() => {
  cleanupTestDb(dbPath);
});

// ── Smoke Test ──────────────────────────────────────────

describe("test infrastructure", () => {
  it("creates and seeds an in-memory DB with all tables", async () => {
    const { clients, projects, weekItems, updates } = await import("@/lib/db/runway-schema");

    // Verify all tables exist and are seeded
    const allClients = await testDb.select().from(clients);
    expect(allClients).toHaveLength(4);

    const allProjects = await testDb.select().from(projects);
    expect(allProjects).toHaveLength(6);

    const allItems = await testDb.select().from(weekItems);
    expect(allItems).toHaveLength(8);

    // Verify updates table exists (empty at start)
    const allUpdates = await testDb.select().from(updates);
    expect(allUpdates).toHaveLength(0);
  });

  it("getRunwayDb returns the test DB", async () => {
    const { getRunwayDb } = await import("@/lib/db/runway");
    expect(getRunwayDb()).toBe(testDb);
  });

  it("operations can insert into updates table", async () => {
    const { updates } = await import("@/lib/db/runway-schema");
    const { insertAuditRecord } = await import("./operations-utils");

    await insertAuditRecord({
      idempotencyKey: "test-key-123",
      updatedBy: "test-user",
      updateType: "test",
      summary: "Test audit record",
    });

    const allUpdates = await testDb.select().from(updates);
    expect(allUpdates).toHaveLength(1);
    expect(allUpdates[0].summary).toBe("Test audit record");
  });
});

// ── Category A: Simple Field Updates ────────────────────

describe("Category A: simple field updates", () => {
  it("A1: updates week item owner", async () => {
    const { updateWeekItemField } = await import("./operations-writes-week");

    const result = await updateWeekItemField({
      weekOf: "2026-04-13",
      weekItemTitle: "CDS Copy Review",
      field: "owner",
      newValue: "Lane",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);

    const item = await getWeekItem(testDb, "wi-cds-review");
    expect(item?.owner).toBe("Lane");

    const audits = await getAuditRecords(testDb, { updateType: "week-field-change" });
    expect(audits).toHaveLength(1);
    expect(audits[0].newValue).toBe("Lane");
    expect(audits[0].previousValue).toBe("Kathy");
  });

  it("A2: updates project notes", async () => {
    const { updateProjectField } = await import("./operations-writes-project");

    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "notes",
      newValue: "Client was 3 weeks late on content.",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);

    const project = await getProject(testDb, "pj-cds");
    expect(project?.notes).toBe("Client was 3 weeks late on content.");

    const audits = await getAuditRecords(testDb, { updateType: "field-change" });
    expect(audits).toHaveLength(1);
    expect(audits[0].newValue).toBe("Client was 3 weeks late on content.");
  });

  it("A3: updates project status (non-cascade)", async () => {
    const { updateProjectStatus } = await import("./operations-writes");

    // Verify original status before update
    const before = await getProject(testDb, "pj-social-cgx");
    expect(before?.status).toBe("not-started");

    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "Social Content",
      newStatus: "in-production",
      updatedBy: "lane",
    });

    expect(result.ok).toBe(true);

    // Verify status changed in DB
    const after = await getProject(testDb, "pj-social-cgx");
    expect(after?.status).toBe("in-production");

    // No cascade for "in-production" — verify result doesn't have cascadedItems
    if (result.ok && result.data) {
      expect(result.data.cascadedItems).toEqual([]);
      expect(result.data.previousStatus).toBe("not-started");
      expect(result.data.newStatus).toBe("in-production");
    }

    // Exactly one audit record
    const audits = await getAuditRecords(testDb, { updateType: "status-change" });
    expect(audits).toHaveLength(1);
  });

  it("A4: updates week item date with reverse cascade", async () => {
    const { updateWeekItemField } = await import("./operations-writes-week");

    const result = await updateWeekItemField({
      weekOf: "2026-04-13",
      weekItemTitle: "Map R2 Launch Deadline",
      field: "date",
      newValue: "2026-04-22",
      updatedBy: "ronan",
    });

    expect(result.ok).toBe(true);

    // Verify week item date changed
    const item = await getWeekItem(testDb, "wi-map-dl");
    expect(item?.date).toBe("2026-04-22");

    // Verify reverse cascade: project dueDate also updated
    const project = await getProject(testDb, "pj-map");
    expect(project?.dueDate).toBe("2026-04-22");

    // Verify result reports the cascade
    if (result.ok && result.data) {
      expect(result.data.reverseCascaded).toBe(true);
    }

    // Exactly one audit record
    const audits = await getAuditRecords(testDb, { updateType: "week-field-change" });
    expect(audits).toHaveLength(1);
  });

  it("A5: updates week item resources", async () => {
    const { updateWeekItemField } = await import("./operations-writes-week");

    // Verify original value
    const before = await getWeekItem(testDb, "wi-social");
    expect(before?.resources).toBeNull();

    const result = await updateWeekItemField({
      weekOf: "2026-04-13",
      weekItemTitle: "AG1 Social Drafts",
      field: "resources",
      newValue: "Lane, Leslie",
      updatedBy: "sami",
    });

    expect(result.ok).toBe(true);

    // Verify exact field match
    const after = await getWeekItem(testDb, "wi-social");
    expect(after?.resources).toBe("Lane, Leslie");

    // Exactly one audit record
    const audits = await getAuditRecords(testDb, { updateType: "week-field-change" });
    expect(audits).toHaveLength(1);
  });
});

// ── Category B: Create Operations ───────────────────────

describe("Category B: create operations", () => {
  it("B1: creates a week item linked to project", async () => {
    const { createWeekItem } = await import("./operations-writes-week");

    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      weekOf: "2026-04-13",
      title: "CDS Final Review",
      category: "review",
      owner: "Kathy",
      resources: "Lane",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);

    // Verify all fields on the new row
    const { weekItems } = await import("@/lib/db/runway-schema");
    const { eq } = await import("drizzle-orm");
    const allItems = await testDb
      .select()
      .from(weekItems)
      .where(eq(weekItems.title, "CDS Final Review"));
    expect(allItems).toHaveLength(1);
    expect(allItems[0].projectId).toBe("pj-cds");
    expect(allItems[0].clientId).toBe("cl-convergix");
    expect(allItems[0].category).toBe("review");
    expect(allItems[0].owner).toBe("Kathy");
    expect(allItems[0].resources).toBe("Lane");
    expect(allItems[0].weekOf).toBe("2026-04-13");

    const audits = await getAuditRecords(testDb, { updateType: "new-week-item" });
    expect(audits).toHaveLength(1);
  });

  it("B2: creates multiple week items (bulk)", async () => {
    const { createWeekItem } = await import("./operations-writes-week");
    const initialCount = (await testDb.select().from((await import("@/lib/db/runway-schema")).weekItems)).length;

    const items = [
      { title: "Batch 1 Drafts", owner: "Sami", date: "2026-04-14", category: "delivery" },
      { title: "Batch 1 Review", owner: "Jill", date: "2026-04-15", category: "review" },
      { title: "Batch 1 Delivery", owner: "Sami", date: "2026-04-16", category: "delivery" },
    ];

    for (const item of items) {
      const result = await createWeekItem({
        clientSlug: "ag1",
        projectName: "Social Content Trial",
        weekOf: "2026-04-13",
        title: item.title,
        owner: item.owner,
        date: item.date,
        category: item.category,
        updatedBy: "jill",
      });
      expect(result.ok).toBe(true);
    }

    // Verify total count
    const { weekItems } = await import("@/lib/db/runway-schema");
    const allItems = await testDb.select().from(weekItems);
    expect(allItems).toHaveLength(initialCount + 3);

    // Verify each individual item's fields
    const { eq } = await import("drizzle-orm");
    for (const expected of items) {
      const rows = await testDb
        .select()
        .from(weekItems)
        .where(eq(weekItems.title, expected.title));
      expect(rows).toHaveLength(1);
      expect(rows[0].owner).toBe(expected.owner);
      expect(rows[0].date).toBe(expected.date);
      expect(rows[0].category).toBe(expected.category);
      expect(rows[0].projectId).toBe("pj-social-ag1");
    }

    const audits = await getAuditRecords(testDb, { updateType: "new-week-item" });
    expect(audits).toHaveLength(3);
  });

  it("B3: creates a project", async () => {
    const { addProject } = await import("./operations-add");

    const result = await addProject({
      clientSlug: "bonterra",
      name: "Q3 Campaign",
      status: "not-started",
      category: "active",
      owner: "Jill",
      updatedBy: "jill",
    });

    expect(result.ok).toBe(true);

    // Verify all fields on the new project
    const { projects } = await import("@/lib/db/runway-schema");
    const { eq } = await import("drizzle-orm");
    const allProjects = await testDb
      .select()
      .from(projects)
      .where(eq(projects.clientId, "cl-bonterra"));
    const newProject = allProjects.find((p) => p.name === "Q3 Campaign");
    expect(newProject).toBeDefined();
    expect(newProject?.owner).toBe("Jill");
    expect(newProject?.status).toBe("not-started");
    expect(newProject?.category).toBe("active");
    expect(newProject?.clientId).toBe("cl-bonterra");

    const audits = await getAuditRecords(testDb, { updateType: "new-item" });
    expect(audits).toHaveLength(1);
    expect(audits[0].newValue).toBe("Q3 Campaign");
  });

  it("B4: logs a free-form update", async () => {
    const { addUpdate } = await import("./operations-add");

    const result = await addUpdate({
      clientSlug: "convergix",
      summary: "Had a great call with Daniel about Q3 plans.",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);

    const audits = await getAuditRecords(testDb, { updateType: "note" });
    expect(audits).toHaveLength(1);
    expect(audits[0].summary).toContain("Convergix");
    expect(audits[0].summary).toContain("great call with Daniel");
    expect(audits[0].updatedBy).toBe("kathy");
  });
});

// ── Category C: Cascade & Interaction ───────────────────

describe("Category C: cascade and interaction", () => {
  it("C1: forward deadline cascade (project dueDate → week items)", async () => {
    const { updateProjectField } = await import("./operations-writes-project");

    // Snapshot unrelated items before
    const cdsReviewBefore = await getWeekItem(testDb, "wi-cds-review");
    const socialBefore = await getWeekItem(testDb, "wi-social");

    const result = await updateProjectField({
      clientSlug: "bonterra",
      projectName: "Impact Report",
      field: "dueDate",
      newValue: "2026-05-20",
      updatedBy: "jill",
    });

    expect(result.ok).toBe(true);

    // Project dueDate updated
    const project = await getProject(testDb, "pj-impact");
    expect(project?.dueDate).toBe("2026-05-20");

    // Deadline week item cascaded
    const deadlineItem = await getWeekItem(testDb, "wi-impact-dl");
    expect(deadlineItem?.date).toBe("2026-05-20");

    // Result reports cascade
    if (result.ok && result.data) {
      expect(result.data.cascadedItems).toContain("Impact Report Deadline");
    }

    // Unrelated items untouched
    const cdsReviewAfter = await getWeekItem(testDb, "wi-cds-review");
    expect(cdsReviewAfter?.date).toBe(cdsReviewBefore?.date);

    const socialAfter = await getWeekItem(testDb, "wi-social");
    expect(socialAfter?.date).toBe(socialBefore?.date);
  });

  it("C2: reverse deadline cascade (week item date → project dueDate)", async () => {
    const { updateWeekItemField } = await import("./operations-writes-week");

    // Snapshot unrelated projects before
    const cdsBefore = await getProject(testDb, "pj-cds");
    const impactBefore = await getProject(testDb, "pj-impact");

    const result = await updateWeekItemField({
      weekOf: "2026-04-13",
      weekItemTitle: "Map R2 Launch Deadline",
      field: "date",
      newValue: "2026-04-25",
      updatedBy: "ronan",
    });

    expect(result.ok).toBe(true);

    const item = await getWeekItem(testDb, "wi-map-dl");
    expect(item?.date).toBe("2026-04-25");

    const project = await getProject(testDb, "pj-map");
    expect(project?.dueDate).toBe("2026-04-25");

    if (result.ok && result.data) {
      expect(result.data.reverseCascaded).toBe(true);
    }

    // Unrelated projects' dueDates untouched
    const cdsAfter = await getProject(testDb, "pj-cds");
    expect(cdsAfter?.dueDate).toBe(cdsBefore?.dueDate);

    const impactAfter = await getProject(testDb, "pj-impact");
    expect(impactAfter?.dueDate).toBe(impactBefore?.dueDate);
  });

  it("C3: idempotent duplicate update", async () => {
    const { updateProjectStatus } = await import("./operations-writes");

    const params = {
      clientSlug: "convergix",
      projectName: "Social Content",
      newStatus: "in-production",
      updatedBy: "lane",
    };

    const first = await updateProjectStatus(params);
    expect(first.ok).toBe(true);

    const second = await updateProjectStatus(params);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.message).toContain("duplicate");
    }

    // Only one audit record (not two)
    const audits = await getAuditRecords(testDb, { updateType: "status-change" });
    expect(audits).toHaveLength(1);
  });

  it("C4: status cascade to linked week items (terminal items protected)", async () => {
    const { updateProjectStatus } = await import("./operations-writes");

    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "completed",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);

    // Project status updated
    const project = await getProject(testDb, "pj-cds");
    expect(project?.status).toBe("completed");

    // Non-terminal items cascaded
    const reviewItem = await getWeekItem(testDb, "wi-cds-review");
    expect(reviewItem?.status).toBe("completed");

    const deliverItem = await getWeekItem(testDb, "wi-cds-deliver");
    expect(deliverItem?.status).toBe("completed");

    // Terminal items protected — NOT overwritten
    const completedItem = await getWeekItem(testDb, "wi-completed");
    expect(completedItem?.status).toBe("completed"); // was already completed

    const canceledItem = await getWeekItem(testDb, "wi-canceled");
    expect(canceledItem?.status).toBe("canceled"); // stays canceled, not overwritten

    // Result reports which items were cascaded
    if (result.ok && result.data) {
      const cascaded = result.data.cascadedItems as string[];
      expect(cascaded).toContain("CDS Copy Review");
      expect(cascaded).toContain("CDS Video Delivery");
      expect(cascaded).not.toContain("CDS Brief Completed");
      expect(cascaded).not.toContain("CDS Retro Canceled");
    }
  });
});

// ── Category D: Fuzzy Matching & Errors ─────────────────

describe("Category D: fuzzy matching and errors", () => {
  it("D1: fuzzy matches partial project name without modifying others", async () => {
    const { updateProjectField } = await import("./operations-writes-project");

    // Snapshot competing projects before
    const socialBefore = await getProject(testDb, "pj-social-cgx");
    const brandBefore = await getProject(testDb, "pj-brand");

    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS",
      field: "notes",
      newValue: "Fuzzy match test",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);

    // Verify the correct project was updated
    const project = await getProject(testDb, "pj-cds");
    expect(project?.notes).toBe("Fuzzy match test");

    // Verify other convergix projects were NOT modified
    const socialAfter = await getProject(testDb, "pj-social-cgx");
    expect(socialAfter?.notes).toBe(socialBefore?.notes);

    const brandAfter = await getProject(testDb, "pj-brand");
    expect(brandAfter?.notes).toBe(brandBefore?.notes);
  });

  it("D2: fuzzy matches partial week item title without modifying others", async () => {
    const { updateWeekItemField } = await import("./operations-writes-week");

    // Snapshot other week items in the same week
    const cdsReviewBefore = await getWeekItem(testDb, "wi-cds-review");
    const mapDlBefore = await getWeekItem(testDb, "wi-map-dl");

    const result = await updateWeekItemField({
      weekOf: "2026-04-13",
      weekItemTitle: "Social Drafts",
      field: "owner",
      newValue: "Lane",
      updatedBy: "sami",
    });

    expect(result.ok).toBe(true);

    // Correct item updated
    const item = await getWeekItem(testDb, "wi-social");
    expect(item?.owner).toBe("Lane");

    // Other items untouched
    const cdsReviewAfter = await getWeekItem(testDb, "wi-cds-review");
    expect(cdsReviewAfter?.owner).toBe(cdsReviewBefore?.owner);

    const mapDlAfter = await getWeekItem(testDb, "wi-map-dl");
    expect(mapDlAfter?.owner).toBe(mapDlBefore?.owner);
  });

  it("D3: returns actionable error for unknown client slug", async () => {
    const { updateProjectStatus } = await import("./operations-writes");

    const result = await updateProjectStatus({
      clientSlug: "nonexistent",
      projectName: "Test",
      newStatus: "completed",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Error should mention the client wasn't found
      expect(result.error).toBeDefined();
      expect(result.error).toContain("nonexistent");
      expect(result.error).toContain("not found");
    }
  });

  it("D4: returns error with available projects for unknown project", async () => {
    const { updateProjectField } = await import("./operations-writes-project");

    const result = await updateProjectField({
      clientSlug: "ag1",
      projectName: "Nonexistent Campaign",
      field: "notes",
      newValue: "test",
      updatedBy: "jill",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toBeDefined();
      expect(result.available).toContain("Social Content Trial");
    }
  });
});

// ── Category E: Undo & Audit ────────────────────────────

describe("Category E: undo and audit", () => {
  it("E1: undoes a single status change", async () => {
    const { updateProjectStatus } = await import("./operations-writes");
    const { undoLastChange } = await import("./operations-writes-undo");

    // Snapshot original status from DB (don't assume seed data)
    const projectOriginal = await getProject(testDb, "pj-cds");
    const originalStatus = projectOriginal?.status;
    expect(originalStatus).toBeTruthy();

    // Change status
    const changeResult = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      newStatus: "blocked",
      updatedBy: "kathy",
    });
    expect(changeResult.ok).toBe(true);

    const projectBefore = await getProject(testDb, "pj-cds");
    expect(projectBefore?.status).toBe("blocked");

    // Undo
    const undoResult = await undoLastChange({ updatedBy: "kathy" });
    expect(undoResult.ok).toBe(true);

    // Status reverted to original
    const projectAfter = await getProject(testDb, "pj-cds");
    expect(projectAfter?.status).toBe(originalStatus);

    // Exactly one undo audit record
    const undoAudits = await getAuditRecords(testDb, { updateType: "undo" });
    expect(undoAudits).toHaveLength(1);
    expect(undoAudits[0].previousValue).toBe("blocked");
    expect(undoAudits[0].newValue).toBe(originalStatus);
  });

  it("E2: undo after multiple changes reverts only the last", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T10:00:00Z"));

    try {
      const { updateProjectStatus } = await import("./operations-writes");
      const { updateProjectField } = await import("./operations-writes-project");
      const { undoLastChange } = await import("./operations-writes-undo");

      // First change: status at T=0
      const statusResult = await updateProjectStatus({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        newStatus: "blocked",
        updatedBy: "kathy",
      });
      expect(statusResult.ok).toBe(true);

      // Advance time to ensure ordering
      vi.advanceTimersByTime(2000);

      // Second change: notes at T+2s
      const notesResult = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "notes",
        newValue: "Temporary note",
        updatedBy: "kathy",
      });
      expect(notesResult.ok).toBe(true);

      // Undo — should revert only the last change (notes)
      const undoResult = await undoLastChange({ updatedBy: "kathy" });
      expect(undoResult.ok).toBe(true);

      const project = await getProject(testDb, "pj-cds");
      // Status stays "blocked" (first change, not reverted)
      expect(project?.status).toBe("blocked");
      // Notes reverted to original (null or empty)
      expect(project?.notes).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Category F: Edge Cases ──────────────────────────────

describe("Category F: edge cases", () => {
  it("F1: handles very long notes field", async () => {
    const { updateProjectField } = await import("./operations-writes-project");

    const longNotes = "A".repeat(10_000);
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "notes",
      newValue: longNotes,
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);

    const project = await getProject(testDb, "pj-cds");
    expect(project?.notes).toBe(longNotes);
    expect(project?.notes?.length).toBe(10_000);
  });

  it("F2: handles special characters in values", async () => {
    const { updateProjectField } = await import("./operations-writes-project");

    const specialValue = `Client said "let's do it" — approved ✓ 🚀 \\ backslash & ampersand <tag> éàü`;
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "notes",
      newValue: specialValue,
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);

    const project = await getProject(testDb, "pj-cds");
    expect(project?.notes).toBe(specialValue);
  });

  it("F3: returns actionable error when searching wrong weekOf for item", async () => {
    const { updateWeekItemField } = await import("./operations-writes-week");

    // wi-other-week is in weekOf 2026-04-06, not 2026-04-13
    const result = await updateWeekItemField({
      weekOf: "2026-04-13",
      weekItemTitle: "Map R2 Kickoff",
      field: "owner",
      newValue: "Lane",
      updatedBy: "ronan",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Error should indicate item wasn't found and list available items
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/not found|no.*match|no.*item/i);
    }
  });
});
