/**
 * Issue #5 enum-drift guard test (isolated mocks).
 *
 * If `CASCADE_STATUSES` ever gains a member that is NOT also in
 * `CASCADE_STATUS_MAP`, the cascade body in `updateProjectStatus` throws a
 * typed error instead of silently writing an invalid enum value into the
 * L2 `week_items.status` column. This is the runtime safety net behind the
 * compile-time `Record<string, WeekItemStatus>` typing on the map.
 *
 * Lives in its own file because the test must replace the mocked
 * `operations-utils` module with a wider `CASCADE_STATUSES` set, which
 * would pollute the shared module cache if colocated with
 * `operations-writes.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/runway", () => {
  const tx = {
    insert: vi.fn(() => ({ values: vi.fn() })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
  };
  return {
    getRunwayDb: () => ({
      insert: vi.fn(() => ({ values: vi.fn() })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
      transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)),
    }),
  };
});

vi.mock("@/lib/db/runway-schema", () => ({
  projects: { id: "id" },
  updates: {},
  weekItems: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));

vi.mock("./operations-utils", () => ({
  // Drift: a hypothetical L1 status is added to the cascade trigger list
  // but the operator forgot to add it to the L1→L2 mapping.
  CASCADE_STATUSES: ["completed", "blocked", "on-hold", "paused-fake"],
  CASCADE_STATUS_MAP: {
    "completed": "completed",
    "blocked": "blocked",
    "on-hold": "blocked",
    // No "paused-fake" entry — this is the drift the guard catches.
  },
  TERMINAL_ITEM_STATUSES: ["completed", "canceled"],
  L1_PROJECT_STATUSES_ARR: [
    "in-production", "awaiting-client", "not-started",
    "blocked", "on-hold", "completed", "canceled", "paused-fake",
  ],
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  generateId: () => "drift-test-id",
  getClientOrFail: async () => ({
    ok: true,
    client: { id: "c1", name: "Convergix", slug: "convergix" },
  }),
  resolveProjectOrFail: async () => ({
    ok: true,
    project: { id: "p1", name: "CDS Messaging", status: "in-production" },
  }),
  checkDuplicate: async () => null,
  insertAuditRecord: async () => "drift-audit-id",
  validateStatusCategoryCompatibility: () => ({ ok: true }),
}));

vi.mock("./operations-reads-week", () => ({
  getLinkedWeekItems: async () => [
    { id: "wi1", title: "Item", status: "in-progress" },
  ],
}));

describe("cascade enum-drift guard (#5)", () => {
  it("throws when a CASCADE_STATUSES value has no CASCADE_STATUS_MAP entry", async () => {
    const { updateProjectStatus } = await import("./operations-writes");
    await expect(
      updateProjectStatus({
        clientSlug: "convergix",
        projectName: "CDS Messaging",
        newStatus: "paused-fake",
        updatedBy: "kathy",
      })
    ).rejects.toThrow(/CASCADE_STATUSES violation/);
  });
});
