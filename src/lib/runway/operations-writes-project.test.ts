import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "./operations-writes-test-helpers";

// ── Mock state ──────────────────────────────────────────
const { db: mockDb, mockInsertValues, mockUpdateSet, mockTx } = createMockDb();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockDb,
}));

vi.mock("@/lib/db/runway-schema", () => ({
  projects: { id: "id" },
  weekItems: { id: "id" },
  updates: {},
  sections: { id: "id", projectId: "projectId" },
  sheetSyncLedger: { runwayId: "runwayId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  inArray: vi.fn((a, b) => ({ inArray: [a, b] })),
}));

const mockGetClientBySlug = vi.fn();
const mockFindProjectByFuzzyName = vi.fn();
const mockGetProjectsForClient = vi.fn();
const mockCheckIdempotency = vi.fn();

let _idCounter = 0;
// Mock `./operations-utils` while letting the real shared validators
// (`validateEngagementType`, `validateIsoDateShape`, etc.) and constants
// (`PROJECT_FIELDS`, `ENGAGEMENT_TYPES`, …) come through via `importOriginal`.
// Inline reimplementations would silently drift from the production source —
// out-of-sync mocks would let the helper-level engagementType / contractStart
// / contractEnd / parentProjectId rejection tests below pass for the wrong
// reason. Only the side-effect-y / DB-touching helpers are overridden.
vi.mock("./operations-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operations-utils")>();
  return {
    ...actual,
    generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
    generateId: () => `mock-id-${++_idCounter}`,
    getClientOrFail: async (slug: string) => {
      const client = await mockGetClientBySlug(slug);
      if (!client) return { ok: false, error: `Client '${slug}' not found.` };
      return { ok: true, client };
    },
    resolveProjectOrFail: async (_clientId: string, _clientName: string, projectName: string) => {
      const result = await mockFindProjectByFuzzyName(_clientId, projectName);
      if (!result) {
        const available = await mockGetProjectsForClient(_clientId);
        return { ok: false, error: `Project '${projectName}' not found for ${_clientName}.`, available: available?.map((p: { name: string }) => p.name) };
      }
      return { ok: true, project: result };
    },
    checkDuplicate: async (idemKey: string, dupResult: unknown) => {
      if (await mockCheckIdempotency(idemKey)) return dupResult;
      return null;
    },
    insertAuditRecord: async (params: Record<string, unknown>) => {
      const id = (params.id as string | undefined) ?? `mock-id-${++_idCounter}`;
      mockInsertValues({ ...params, id });
      return id;
    },
    getPreviousValue: (entity: Record<string, unknown>, columnKey: string) => String(entity[columnKey] ?? ""),
    // v4 (Chunk 5): identity passthrough — real normalization asserted
    // separately in operations-utils.test.ts.
    normalizeResourcesString: (raw: string | null | undefined) => raw ?? "",
    // parentProjectId validator is a DB-touching check. The unit tests below
    // exercise the field whitelist + non-validator paths only; the real
    // validator is covered by the integration test in
    // parent-project-id-validators.test.ts. Stub returns ok:true so the
    // updateProjectField parentProjectId branch reaches the persistence step
    // when needed.
    validateParentProjectIdAssignment: async () => ({ ok: true }),
  };
});

const mockGetLinkedDeadlineItems = vi.fn();

vi.mock("./operations-reads-week", () => ({
  getLinkedDeadlineItems: (...args: unknown[]) => mockGetLinkedDeadlineItems(...args),
}));

const client = { id: "c1", name: "Convergix", slug: "convergix" };
const project = {
  id: "p1",
  name: "CDS Messaging",
  status: "in-production",
  category: "active",
  dueDate: "2026-04-15",
  owner: "Kathy",
  resources: "Roz",
  waitingOn: null,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  _idCounter = 0;
  mockCheckIdempotency.mockResolvedValue(false);
  mockGetLinkedDeadlineItems.mockResolvedValue([]);
});

describe("updateProjectField", () => {
  it("updates dueDate field and inserts audit record", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-25",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        clientName: "Convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        previousValue: "2026-04-15",
        newValue: "2026-04-25",
        cascadedItems: [],
        // PR #86: structured per-item trace (empty — no linked deadline items in this test).
        cascadeDetail: [],
        auditId: expect.any(String),
      });
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: "2026-04-25" })
    );
    expect(mockInsertValues).toHaveBeenCalled();
  });

  it("updates owner field", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "owner",
      newValue: "Lane",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "Lane" })
    );
  });

  it("updates name field", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "name",
      newValue: "CDS Engagement Videos",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CDS Engagement Videos" })
    );
  });

  it("updates category field and captures previous value in audit record", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "category",
      newValue: "awaiting-client",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        clientName: "Convergix",
        projectName: "CDS Messaging",
        field: "category",
        previousValue: "active",
        newValue: "awaiting-client",
        cascadedItems: [],
        cascadeDetail: [],
        auditId: expect.any(String),
      });
    }
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ category: "awaiting-client" })
    );
    // Audit record captures the category change
    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.updateType).toBe("field-change");
    expect(insertCall.previousValue).toBe("active");
    expect(insertCall.newValue).toBe("awaiting-client");
    expect(insertCall.metadata).toBe(JSON.stringify({ field: "category" }));
  });

  it("returns error when client not found", async () => {
    mockGetClientBySlug.mockResolvedValue(null);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "unknown",
      projectName: "Test",
      field: "dueDate",
      newValue: "2026-05-01",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unknown");
    }
  });

  it("returns error with available projects when project not found", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(null);
    mockGetProjectsForClient.mockResolvedValue([
      { name: "CDS Messaging" },
      { name: "Website" },
    ]);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "Nonexistent",
      field: "owner",
      newValue: "Lane",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.available).toEqual(["CDS Messaging", "Website"]);
    }
  });

  it("returns success without writing on duplicate request", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockCheckIdempotency.mockResolvedValue(true);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-25",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("duplicate");
      expect(result.data).toBeDefined();
    }
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("rejects invalid field name", async () => {
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS",
      field: "invalid_field",
      newValue: "foo",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("invalid_field");
      expect(result.error).toContain("Allowed fields");
    }
  });

  it("captures previous value in audit record", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "owner",
      newValue: "Lane",
      updatedBy: "kathy",
    });

    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.updateType).toBe("field-change");
    expect(insertCall.previousValue).toBe("Kathy");
    expect(insertCall.newValue).toBe("Lane");
  });

  it("includes metadata with field name in audit record", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-25",
      updatedBy: "kathy",
    });

    const insertCall = mockInsertValues.mock.calls[0][0];
    expect(insertCall.metadata).toBe(JSON.stringify({ field: "dueDate" }));
  });

  it("cascades dueDate to linked deadline week items", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedDeadlineItems.mockResolvedValue([
      { id: "wi-1", title: "Code handoff", category: "deadline" },
      { id: "wi-2", title: "Go live", category: "deadline" },
    ]);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual(["Code handoff", "Go live"]);
    }
    // #22 + H-1: cascade is now direction-aware AND triggers a parent
    // recompute after the cascade loop. With no current startDate on the
    // mock items, every cascade takes the FORWARD path which splits into
    // 2 tx.update calls per L2 (endDate first, then startDate+date+
    // dayOfWeek). Then a final recompute fires on the L1 to refresh its
    // derived dates. So: 1 project field update + (2 items × 2 L2 writes)
    // + 1 L1 recompute = 6 mockUpdateSet calls.
    expect(mockUpdateSet).toHaveBeenCalledTimes(6);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-04-28" })
    );
  });

  it("does not cascade non-dueDate field changes", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "owner",
      newValue: "Lane",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    expect(mockGetLinkedDeadlineItems).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual([]);
    }
  });

  it("handles no linked deadline items gracefully", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedDeadlineItems.mockResolvedValue([]);

    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.cascadedItems).toEqual([]);
    }
    // Only the project update itself
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
  });

  // v4 §8: cascade-generated audit rows carry triggeredByUpdateId FK.
  it("emits per-item cascade audit rows linked to parent via triggeredByUpdateId", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedDeadlineItems.mockResolvedValue([
      { id: "wi-1", title: "Code handoff", category: "deadline" },
      { id: "wi-2", title: "Go live", category: "deadline" },
    ]);

    const { updateProjectField } = await import("./operations-writes-project");
    await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    const calls = mockInsertValues.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(3);

    const parent = calls[0];
    expect(parent.updateType).toBe("field-change");
    expect(parent.id).toBeTruthy();
    expect(parent.triggeredByUpdateId).toBeFalsy();

    const cascades = calls.slice(1);
    expect(cascades.every((c) => c.updateType === "cascade-duedate")).toBe(true);
    expect(cascades.every((c) => c.triggeredByUpdateId === parent.id)).toBe(true);
    expect(cascades.map((c) => c.summary)).toEqual([
      "Cascaded from CDS Messaging dueDate change: Code handoff → 2026-04-28",
      "Cascaded from CDS Messaging dueDate change: Go live → 2026-04-28",
    ]);
  });

  it("does not emit cascade audit rows when no linked deadline items", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockGetLinkedDeadlineItems.mockResolvedValue([]);

    const { updateProjectField } = await import("./operations-writes-project");
    await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "dueDate",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });

    expect(mockInsertValues.mock.calls).toHaveLength(1);
    expect(mockInsertValues.mock.calls[0][0].updateType).toBe("field-change");
  });

  // PR #86: MCP/bot consumers parse cascade outcomes from `data.cascadeDetail`
  // rather than the prose `message` string.
  describe("structured response (cascadeDetail + auditId)", () => {
    it("returns cascadeDetail with each linked deadline item's audit id", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedDeadlineItems.mockResolvedValue([
        { id: "wi-1", title: "Code handoff", category: "deadline", date: "2026-04-15" },
        { id: "wi-2", title: "Go live", category: "deadline", date: null },
      ]);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.cascadeDetail).toEqual([
        {
          itemId: "wi-1",
          itemTitle: "Code handoff",
          field: "date",
          previousValue: "2026-04-15",
          newValue: "2026-04-28",
          auditId: expect.any(String),
        },
        {
          itemId: "wi-2",
          itemTitle: "Go live",
          field: "date",
          previousValue: null,
          newValue: "2026-04-28",
          auditId: expect.any(String),
        },
      ]);

      // Back-compat: `cascadedItems` is still the title array.
      expect(result.data?.cascadedItems).toEqual(["Code handoff", "Go live"]);

      // cascadeDetail.auditId values match the child audit inserts.
      const calls = mockInsertValues.mock.calls.map((c) => c[0]);
      expect(result.data?.auditId).toBe(calls[0].id);
      expect(result.data?.cascadeDetail[0].auditId).toBe(calls[1].id);
      expect(result.data?.cascadeDetail[1].auditId).toBe(calls[2].id);
    });

    it("returns empty cascadeDetail for non-dueDate field changes", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "owner",
        newValue: "Lane",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.cascadeDetail).toEqual([]);
      expect(result.data?.auditId).toBeTruthy();
      expect(mockGetLinkedDeadlineItems).not.toHaveBeenCalled();
    });
  });

  // ── #22: cascade-duedate also syncs startDate / endDate / dayOfWeek
  describe("cascade-duedate full date sync (#22)", () => {
    it("skips deadline L2s in terminal status (completed)", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedDeadlineItems.mockResolvedValue([
        { id: "wi-done", title: "Code handoff", category: "deadline", status: "completed", date: "2026-04-10" },
      ]);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      // Project update only — the completed L2 is skipped, no L2 writes.
      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
      // cascadedItems should be empty since we skipped.
      if (result.ok) {
        expect(result.data?.cascadedItems).toEqual([]);
      }
      // And no cascade audit row should emit for the skipped L2.
      const calls = mockInsertValues.mock.calls.map((c) => c[0]);
      expect(calls.filter((c) => c.updateType === "cascade-duedate")).toHaveLength(0);
    });

    it("skips deadline L2s in terminal status (canceled)", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedDeadlineItems.mockResolvedValue([
        { id: "wi-cx", title: "Go live", category: "deadline", status: "canceled", date: "2026-04-10" },
      ]);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledTimes(1);
      if (result.ok) expect(result.data?.cascadedItems).toEqual([]);
    });

    it("FORWARD direction: writes endDate first, then startDate + date + dayOfWeek (lowercase)", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedDeadlineItems.mockResolvedValue([
        // Current item lives at 2026-04-10. Cascade pulls it forward to 2026-04-28.
        { id: "wi-f", title: "Code handoff", category: "deadline", status: "in-progress", date: "2026-04-10", startDate: "2026-04-10", endDate: "2026-04-10" },
      ]);

      const { updateProjectField } = await import("./operations-writes-project");
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      // calls[0] = the project field-change update.
      // calls[1] = L2 endDate write (forward leading).
      // calls[2] = L2 startDate+date+dayOfWeek combined write.
      // calls[3] = L1 recompute (H-1: refreshes derived dates after cascade).
      const calls = mockUpdateSet.mock.calls.map((c) => c[0]);
      expect(calls).toHaveLength(4);
      // First L2 write: endDate only.
      expect(calls[1]).toMatchObject({ endDate: "2026-04-28" });
      expect(calls[1]).not.toHaveProperty("startDate");
      expect(calls[1]).not.toHaveProperty("date");
      // Second L2 write: startDate + date + dayOfWeek (lowercase).
      expect(calls[2]).toMatchObject({
        startDate: "2026-04-28",
        date: "2026-04-28",
        dayOfWeek: "tuesday", // 2026-04-28 is Tuesday
      });
    });

    it("BACKWARD direction: writes startDate first, then endDate + date + dayOfWeek (lowercase)", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedDeadlineItems.mockResolvedValue([
        // Current item at 2026-05-15. Cascade pulls back to 2026-04-28.
        { id: "wi-b", title: "Code handoff", category: "deadline", status: "in-progress", date: "2026-05-15", startDate: "2026-05-15", endDate: "2026-05-15" },
      ]);

      const { updateProjectField } = await import("./operations-writes-project");
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      const calls = mockUpdateSet.mock.calls.map((c) => c[0]);
      // 1 project + 1 L2 startDate + 1 L2 endDate+date+dayOfWeek + 1 L1 recompute = 4.
      expect(calls).toHaveLength(4);
      // First L2 write: startDate only (backward leading).
      expect(calls[1]).toMatchObject({ startDate: "2026-04-28" });
      expect(calls[1]).not.toHaveProperty("endDate");
      // Second L2 write: endDate + date + dayOfWeek.
      expect(calls[2]).toMatchObject({
        endDate: "2026-04-28",
        date: "2026-04-28",
        dayOfWeek: "tuesday",
      });
    });

    it("computes lowercase dayOfWeek across the week", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const cases: Array<{ date: string; expected: string }> = [
        // 2026-04-26 = Sunday, 2026-04-27 = Monday, ..., 2026-05-02 = Saturday
        { date: "2026-04-26", expected: "sunday" },
        { date: "2026-04-27", expected: "monday" },
        { date: "2026-04-28", expected: "tuesday" },
        { date: "2026-04-29", expected: "wednesday" },
        { date: "2026-04-30", expected: "thursday" },
        { date: "2026-05-01", expected: "friday" },
        { date: "2026-05-02", expected: "saturday" },
      ];

      for (const { date, expected } of cases) {
        vi.clearAllMocks();
        _idCounter = 0;
        mockCheckIdempotency.mockResolvedValue(false);
        mockGetClientBySlug.mockResolvedValue(client);
        mockFindProjectByFuzzyName.mockResolvedValue(project);
        mockGetLinkedDeadlineItems.mockResolvedValue([
          { id: `wi-${date}`, title: "Item", category: "deadline", status: "in-progress", date: "2026-04-10", startDate: "2026-04-10", endDate: "2026-04-10" },
        ]);

        const { updateProjectField } = await import("./operations-writes-project");
        await updateProjectField({
          clientSlug: "convergix",
          projectName: "CDS Messaging",
          field: "dueDate",
          newValue: date,
          updatedBy: "kathy",
        });

        const calls = mockUpdateSet.mock.calls.map((c) => c[0]);
        const combined = calls.find((c) => "dayOfWeek" in c);
        expect(combined?.dayOfWeek).toBe(expected);
      }
    });

    it("WR-04 lock-in: when new dueDate is null, writes ONLY date=null on the L2 (intentional half-clear; full L2 cleanup is operator-followed)", async () => {
      // WR-04 — explicit lock-in test. When operator clears L1.dueDate, the
      // existing legacy behavior writes only date=null on linked deadline
      // L2s, leaving startDate / endDate / dayOfWeek as their pre-clear
      // values. This is INTENTIONALLY out of scope for the #22 fix: the
      // null write itself violates feedback_no_nulls_in_prod_db ("never
      // leave date field null"), so the right structural cleanup is "block
      // the dueDate=null write OR require operator-driven L2 cleanup".
      // That's a separate semantic decision; this PR preserves the prior
      // behavior verbatim and locks it in test so a future maintainer
      // doesn't "fix" the half-clear without thinking through whether
      // null-clear should be allowed at all. See WR-04 in the cc review.
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedDeadlineItems.mockResolvedValue([
        { id: "wi-clear", title: "Code handoff", category: "deadline", status: "in-progress", date: "2026-04-10", startDate: "2026-04-10", endDate: "2026-04-10" },
      ]);

      const { updateProjectField } = await import("./operations-writes-project");
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        newValue: null,
        updatedBy: "kathy",
      });

      const calls = mockUpdateSet.mock.calls.map((c) => c[0]);
      // 1 project field update + 1 L2 date=null + 1 L1 recompute (post-cascade
      // refresh per H-1) = 3. Critically, the L2 write at calls[1] writes
      // ONLY date — startDate / endDate / dayOfWeek are NOT in the patch.
      expect(calls).toHaveLength(3);
      expect(calls[1]).toEqual({ date: null, updatedAt: expect.any(Date) });
      expect(calls[1]).not.toHaveProperty("startDate");
      expect(calls[1]).not.toHaveProperty("endDate");
      expect(calls[1]).not.toHaveProperty("dayOfWeek");
    });

    it("H-1 lock-in: after cascade-duedate fires, recomputeProjectDatesWith is called on the parent L1", async () => {
      // H-1 — fresh-eyes QA finding. #22 introduced cascade writes to
      // L2.startDate / endDate, which feed the L1's MIN/MAX derivation.
      // Without a post-cascade recompute, L1.startDate / endDate go stale
      // until the next unrelated L2 write triggers one. The fix is a
      // recomputeProjectDatesWith call after the cascade loop, inside the
      // same transaction. This test pins the "recompute fired" signal at
      // the mock layer; integration coverage that proves derived dates
      // actually move lives in operations-writes-week-recompute.test.ts.
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedDeadlineItems.mockResolvedValue([
        { id: "wi-h1", title: "Code handoff", category: "deadline", status: "in-progress", date: "2026-04-10", startDate: "2026-04-10", endDate: "2026-04-10" },
      ]);

      const { updateProjectField } = await import("./operations-writes-project");
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      // 1 project field update + 2 L2 writes (forward direction) + 1 L1
      // recompute = 4. The recompute mock-write surface is identical to
      // any update on projects (mockSelectResult is empty so the
      // recompute writes {startDate: null, endDate: null}), but the
      // important signal is that the 4th call exists.
      const calls = mockUpdateSet.mock.calls.map((c) => c[0]);
      expect(calls).toHaveLength(4);
      // Last call is the recompute on the parent project.
      expect(calls[3]).toEqual(
        expect.objectContaining({ updatedAt: expect.any(Date) }),
      );
    });

    it("H-1: skip the post-cascade recompute when no L2 was actually cascaded (terminal-only deadlines)", async () => {
      // H-1 negative case: when all deadline L2s are terminal-status (so
      // cascadedIds stays empty), the post-cascade recompute should NOT
      // fire — there's nothing for the L1 to re-derive from. Saves a
      // pointless tx.update on the project row.
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockGetLinkedDeadlineItems.mockResolvedValue([
        { id: "wi-terminal", title: "Code handoff", category: "deadline", status: "completed", date: "2026-04-10" },
      ]);

      const { updateProjectField } = await import("./operations-writes-project");
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "dueDate",
        newValue: "2026-04-28",
        updatedBy: "kathy",
      });

      const calls = mockUpdateSet.mock.calls.map((c) => c[0]);
      // Only the project field-change update; the L2 was skipped AND
      // the post-cascade recompute was skipped because nothing cascaded.
      expect(calls).toHaveLength(1);
    });
  });

  // Helper-level value validation — batch_apply bypasses the MCP wrapper, so
  // these checks have to live in the helper. Mirrors the
  // parent-project-id-validators.test.ts pattern.
  describe("helper-level value validation", () => {
    it("rejects invalid engagementType before any DB write", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "engagementType",
        newValue: "retainer-v2",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/engagementType must be/);
        expect(result.error).toContain("retainer-v2");
      }
      expect(mockUpdateSet).not.toHaveBeenCalled();
      expect(mockInsertValues).not.toHaveBeenCalled();
    });

    it("accepts valid engagementType ('retainer') and persists it", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "engagementType",
        newValue: "retainer",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ engagementType: "retainer" })
      );
    });

    it("rejects shape-invalid contractStart before any DB write", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "contractStart",
        newValue: "not-a-date",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/contractStart must be a valid ISO/);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("rejects date-invalid contractStart '2026-13-45' before any DB write", async () => {
      // This is the load-bearing case from the P1 finding — string compare
      // against contractEnd would silently accept "2026-13-45" lexicographically.
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "contractStart",
        newValue: "2026-13-45",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/contractStart must be a valid ISO/);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("rejects shape-invalid contractEnd before any DB write", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "contractEnd",
        newValue: "garbage",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/contractEnd must be a valid ISO/);
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("accepts valid contractStart and persists it", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue({ ...project, contractEnd: null });

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "contractStart",
        newValue: "2027-02-01",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ contractStart: "2027-02-01" })
      );
    });

    it("accepts empty string to clear engagementType (becomes null)", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue({
        ...project,
        engagementType: "retainer",
      });

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "engagementType",
        newValue: "",
        updatedBy: "batch",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ engagementType: null })
      );
    });
  });

  // Null newValue support: retainer/v4 cleanup migrations clear fields like
  // contractEnd, waitingOn, target. The helper accepts newValue: null as a
  // first-class write — storing SQL NULL and audit-logging "(null)".
  describe("null newValue writes", () => {
    it("writes SQL NULL when newValue is null", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue({
        ...project,
        contractEnd: "2026-05-31",
      });

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "contractEnd",
        newValue: null,
        updatedBy: "migration",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ contractEnd: null })
      );
    });

    it("audit row newValue is null for null writes", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "waitingOn",
        newValue: null,
        updatedBy: "migration",
      });

      const insertCall = mockInsertValues.mock.calls[0][0];
      expect(insertCall.newValue).toBe(null);
      expect(insertCall.summary).toContain('"(null)"');
    });

    it("idempotency key uses (null) marker so null writes collapse on re-run", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "waitingOn",
        newValue: null,
        updatedBy: "migration",
      });

      // Mocked generateIdempotencyKey joins parts with "|" — the idemKey must
      // contain the "(null)" marker rather than the literal string "null".
      const auditCall = mockInsertValues.mock.calls[0][0];
      expect(auditCall.idempotencyKey).toContain("|(null)|");
    });

    it("repeat null write returns duplicate result without re-writing", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      mockCheckIdempotency.mockResolvedValue(true);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "waitingOn",
        newValue: null,
        updatedBy: "migration",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message).toContain("duplicate");
        expect(result.data?.newValue).toBe(null);
      }
      expect(mockUpdateSet).not.toHaveBeenCalled();
    });

    it("clearing resources with null skips normalizer and stores null", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "resources",
        newValue: null,
        updatedBy: "migration",
      });

      expect(result.ok).toBe(true);
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ resources: null })
      );
      if (result.ok) expect(result.data?.newValue).toBe(null);
    });
  });

  // ── Wave 0b validators + auditObserver ───────────────────

  describe("Wave 0b: updateProjectField validators + observer", () => {
    it("rejects category update that violates status/category compat", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      // Project has status=in-production. Setting category=on-hold violates
      // the matrix.
      mockFindProjectByFuzzyName.mockResolvedValue({
        ...project,
        status: "in-production",
      });

      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "category",
        newValue: "on-hold",
        updatedBy: "modal",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/'in-production' is incompatible with category 'on-hold'/);
      }
    });

    it("rejects bare resource on resources update", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "resources",
        newValue: "Kathy",
        updatedBy: "modal",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/role prefix/);
    });

    it("rejects notes update exceeding L1 max length (500)", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      const { updateProjectField } = await import("./operations-writes-project");
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "notes",
        newValue: "A".repeat(501),
        updatedBy: "modal",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/L1 notes max length is 500/);
    });

    it("auditObserver fires with project entityType + propagated source", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      const { updateProjectField } = await import("./operations-writes-project");
      const events: unknown[] = [];
      const result = await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "owner",
        newValue: "Lane",
        updatedBy: "slack:U777:modal-edit",
        auditObserver: (e) => events.push(e),
        source: "slack-modal-bot",
      });
      expect(result.ok).toBe(true);
      expect(events).toHaveLength(1);
      const e = events[0] as Record<string, unknown>;
      expect(e.source).toBe("slack-modal-bot");
      expect(e.entityType).toBe("project");
      expect(e.entityId).toBe("p1");
      expect(e.updatedBy).toBe("slack:U777:modal-edit");
    });

    it("auditObserver passes source=null when omitted", async () => {
      mockGetClientBySlug.mockResolvedValue(client);
      mockFindProjectByFuzzyName.mockResolvedValue(project);
      const { updateProjectField } = await import("./operations-writes-project");
      const events: unknown[] = [];
      await updateProjectField({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        field: "owner",
        newValue: "Lane",
        updatedBy: "kathy",
        auditObserver: (e) => events.push(e),
      });
      expect(events).toHaveLength(1);
      expect((events[0] as { source: unknown }).source).toBeNull();
    });
  });
});

describe("deleteProject", () => {
  it("deletes project and audits", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain("CDS Messaging");
      expect(result.data).toEqual({ clientName: "Convergix", projectName: "CDS Messaging" });
    }
    // Audit record
    const auditCall = mockInsertValues.mock.calls[0][0];
    expect(auditCall.updateType).toBe("delete-project");
    expect(auditCall.previousValue).toBe("CDS Messaging");
  });

  it("returns error for unknown client", async () => {
    mockGetClientBySlug.mockResolvedValue(null);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "unknown",
      projectName: "Test",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
  });

  it("returns error for unknown project", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(null);
    mockGetProjectsForClient.mockResolvedValue([{ name: "CDS Messaging" }]);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "convergix",
      projectName: "Nonexistent",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.available).toEqual(["CDS Messaging"]);
  });

  it("handles duplicate request", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);
    mockCheckIdempotency.mockResolvedValue(true);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
  });

  it("nulls out projectId on audit records before deleting project", async () => {
    mockGetClientBySlug.mockResolvedValue(client);
    mockFindProjectByFuzzyName.mockResolvedValue(project);

    const { deleteProject } = await import("./operations-writes-project");
    const result = await deleteProject({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      updatedBy: "kathy",
    });

    expect(result.ok).toBe(true);

    // Transaction should have 3 calls: unlink week items, null audit projectIds, delete project
    expect(mockTx.update).toHaveBeenCalledTimes(2);
    expect(mockTx.delete).toHaveBeenCalledTimes(1);

    // Second tx.update call should null out projectId on audit records
    const secondUpdateSetCall = mockUpdateSet.mock.calls.find(
      (call: unknown[]) => call[0] && typeof call[0] === "object" && "projectId" in (call[0] as Record<string, unknown>) && !("updatedAt" in (call[0] as Record<string, unknown>))
    );
    expect(secondUpdateSetCall).toBeDefined();
    expect(secondUpdateSetCall![0]).toEqual({ projectId: null });
  });
});
