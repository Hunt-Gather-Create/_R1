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
