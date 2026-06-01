/**
 * Thin coverage for runway server actions. These are 4-line wrappers over
 * `setViewPreferences` (covered in view-preferences.test.ts) and
 * `revalidatePath`. Verifies the toggle dispatches reach both collaborators
 * with the right preference key.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/runway/view-preferences", () => ({
  setViewPreferences: vi.fn(async (patch: unknown) => ({ ok: true, patch })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// `setWeekItemStatusAction` reads a row by id then delegates to the
// canonical write helper. Both collaborators are mocked so the test can
// drive each branch (row-not-found, null-weekOf guard, validator failure,
// happy path) without spinning up a Turso connection.
let mockedRow: Record<string, unknown> | undefined;
vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (mockedRow ? [mockedRow] : []),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/db/runway-schema", () => ({
  weekItems: { id: "id" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));
vi.mock("@/lib/runway/operations-writes-week", () => ({
  updateWeekItemField: vi.fn(async () => ({ ok: true })),
}));

import { setViewPreferences } from "@/lib/runway/view-preferences";
import { revalidatePath } from "next/cache";
import { updateWeekItemField } from "@/lib/runway/operations-writes-week";
import {
  toggleInFlightAction,
  toggleNeedsUpdateAction,
  setWeekItemStatusAction,
  updateWeekItemFieldsAction,
} from "./actions";

const mockedSet = vi.mocked(setViewPreferences);
const mockedRevalidate = vi.mocked(revalidatePath);
const mockedUpdate = vi.mocked(updateWeekItemField);

beforeEach(() => {
  mockedSet.mockClear();
  mockedRevalidate.mockClear();
  mockedUpdate.mockClear();
  mockedRow = undefined;
});

describe("toggleInFlightAction", () => {
  it("persists inFlightToggle and revalidates /runway", async () => {
    await toggleInFlightAction(false);
    expect(mockedSet).toHaveBeenCalledWith({ inFlightToggle: false });
    expect(mockedRevalidate).toHaveBeenCalledWith("/runway");
  });

  it("returns the persisted preferences object", async () => {
    const result = await toggleInFlightAction(true);
    expect(result).toEqual({ ok: true, patch: { inFlightToggle: true } });
  });
});

describe("toggleNeedsUpdateAction", () => {
  it("persists needsUpdateToggle and revalidates /runway", async () => {
    await toggleNeedsUpdateAction(false);
    expect(mockedSet).toHaveBeenCalledWith({ needsUpdateToggle: false });
    expect(mockedRevalidate).toHaveBeenCalledWith("/runway");
  });

  it("returns the persisted preferences object", async () => {
    const result = await toggleNeedsUpdateAction(true);
    expect(result).toEqual({ ok: true, patch: { needsUpdateToggle: true } });
  });
});

describe("setWeekItemStatusAction", () => {
  it("returns an error result when the row is not found", async () => {
    mockedRow = undefined;
    const result = await setWeekItemStatusAction({
      weekItemId: "missing",
      newStatus: "completed",
    });
    expect(result).toEqual({
      ok: false,
      error: "Week item 'missing' not found.",
    });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("returns an error result when the row has no weekOf anchor", async () => {
    mockedRow = {
      id: "wi-1",
      title: "Untitled",
      weekOf: null,
      status: "scheduled",
    };
    const result = await setWeekItemStatusAction({
      weekItemId: "wi-1",
      newStatus: "completed",
    });
    expect(result).toEqual({
      ok: false,
      error: "Week item 'wi-1' has no weekOf anchor.",
    });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("passes through the validator error when the write helper rejects", async () => {
    mockedRow = {
      id: "wi-2",
      title: "Edit Post",
      weekOf: "2026-05-25",
      status: "in-progress",
    };
    mockedUpdate.mockResolvedValueOnce({
      ok: false,
      error: "status enum invalid",
    });
    const result = await setWeekItemStatusAction({
      weekItemId: "wi-2",
      newStatus: "bogus",
    });
    expect(result).toEqual({ ok: false, error: "status enum invalid" });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("delegates to updateWeekItemField with the row's composite key and returns previousStatus", async () => {
    mockedRow = {
      id: "wi-3",
      title: "Brand: Hero",
      weekOf: "2026-06-01",
      status: "in-progress",
    };
    const result = await setWeekItemStatusAction({
      weekItemId: "wi-3",
      newStatus: "completed",
    });
    expect(mockedUpdate).toHaveBeenCalledWith({
      weekOf: "2026-06-01",
      weekItemTitle: "Brand: Hero",
      field: "status",
      newValue: "completed",
      updatedBy: "runway:dashboard",
      source: "dashboard",
    });
    expect(mockedRevalidate).toHaveBeenCalledWith("/runway");
    expect(result).toEqual({ ok: true, previousStatus: "in-progress" });
  });

  it("replays with newStatus=null for undo and propagates the previous status as captured", async () => {
    mockedRow = {
      id: "wi-4",
      title: "Edit Post",
      weekOf: "2026-05-25",
      status: "completed",
    };
    const result = await setWeekItemStatusAction({
      weekItemId: "wi-4",
      newStatus: null,
    });
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ newValue: null }),
    );
    expect(result).toEqual({ ok: true, previousStatus: "completed" });
  });
});

// #70 — dashboard L2 edit modal save handler. Multi-field wrapper around
// updateWeekItemField; captures previousValues for the modal's undo
// toast and applies each change one field at a time so validators fire
// identically to the slack + MCP paths.
describe("updateWeekItemFieldsAction", () => {
  it("returns an error result when the row is not found", async () => {
    mockedRow = undefined;
    const result = await updateWeekItemFieldsAction({
      weekItemId: "missing",
      updatedBy: "Jason",
      fields: { title: "New" },
    });
    expect(result).toEqual({
      ok: false,
      error: "Week item 'missing' not found.",
    });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("returns an error result when the row has no weekOf anchor", async () => {
    mockedRow = {
      id: "wi-x",
      title: "T",
      weekOf: null,
    };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-x",
      updatedBy: "Jason",
      fields: { title: "New" },
    });
    expect(result).toEqual({
      ok: false,
      error: "Week item 'wi-x' has no weekOf anchor.",
    });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("returns ok with empty previousValues and no writes when the patch is empty", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
    };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: {},
    });
    expect(result).toEqual({ ok: true, previousValues: {} });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("captures previousValues from the row BEFORE writing", async () => {
    mockedRow = {
      id: "wi-1",
      title: "Old title",
      weekOf: "2026-06-01",
      owner: "Old owner",
      notes: "Old notes",
      status: "scheduled",
      resources: null,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      dayOfWeek: "monday",
    };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: {
        title: "New title",
        owner: "New owner",
        notes: "New notes",
      },
    });
    expect(result).toEqual({
      ok: true,
      previousValues: {
        title: "Old title",
        owner: "Old owner",
        notes: "Old notes",
      },
    });
  });

  it("writes each changed field with updatedBy + source='dashboard'", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      owner: "X",
    };
    await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason Burks",
      fields: { owner: "Jill" },
    });
    expect(mockedUpdate).toHaveBeenCalledWith({
      weekOf: "2026-06-01",
      weekItemTitle: "T",
      field: "owner",
      newValue: "Jill",
      updatedBy: "Jason Burks",
      source: "dashboard",
    });
    expect(mockedRevalidate).toHaveBeenCalledWith("/runway");
  });

  it("writes title LAST so subsequent field writes still resolve the row by its original title", async () => {
    mockedRow = {
      id: "wi-1",
      title: "Original",
      weekOf: "2026-06-01",
      owner: "X",
    };
    await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { title: "Renamed", owner: "Jill" },
    });
    const orderedTitles = mockedUpdate.mock.calls.map((c) => {
      const arg = c[0] as { field: string; weekItemTitle: string };
      return [arg.field, arg.weekItemTitle];
    });
    // owner write uses original title; title write fires last.
    expect(orderedTitles).toEqual([
      ["owner", "Original"],
      ["title", "Original"],
    ]);
  });

  it("orders startDate and endDate so the per-field cross-date guard passes on intermediate state (forward move)", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    };
    // Forward move: both dates moving later. New startDate (6/10) > current
    // endDate (6/2) but new endDate (6/12) >= current startDate (6/1), so
    // endDate is safe to write first.
    await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { startDate: "2026-06-10", endDate: "2026-06-12" },
    });
    const orderedFields = mockedUpdate.mock.calls.map(
      (c) => (c[0] as { field: string }).field,
    );
    expect(orderedFields).toEqual(["endDate", "startDate"]);
  });

  it("orders startDate and endDate (backward move) so startDate writes first", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      startDate: "2026-06-10",
      endDate: "2026-06-12",
    };
    // Backward move: new endDate (6/2) < current startDate (6/10) but new
    // startDate (6/1) <= current endDate (6/12), so startDate is safe first.
    await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { startDate: "2026-06-01", endDate: "2026-06-02" },
    });
    const orderedFields = mockedUpdate.mock.calls.map(
      (c) => (c[0] as { field: string }).field,
    );
    expect(orderedFields).toEqual(["startDate", "endDate"]);
  });

  it("propagates the first updateWeekItemField error and does not revalidate", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      owner: "X",
    };
    mockedUpdate.mockResolvedValueOnce({
      ok: false,
      error: "validator rejected: notes too long",
    });
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { owner: "Jill" },
    });
    expect(result).toEqual({
      ok: false,
      error: "validator rejected: notes too long",
    });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });
});
