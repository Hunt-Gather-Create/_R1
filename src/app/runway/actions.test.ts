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
  linkWeekItemToProject: vi.fn(async () => ({
    ok: true,
    data: { previousProjectId: null, newProjectId: "p-new" },
  })),
}));
let mockedProjectsForClient: Array<Record<string, unknown>> = [];
vi.mock("@/lib/runway/operations-utils", () => ({
  getProjectsForClient: vi.fn(async () => mockedProjectsForClient),
}));

import { setViewPreferences } from "@/lib/runway/view-preferences";
import { revalidatePath } from "next/cache";
import {
  updateWeekItemField,
  linkWeekItemToProject,
} from "@/lib/runway/operations-writes-week";
import {
  toggleInFlightAction,
  toggleNeedsUpdateAction,
  setWeekItemStatusAction,
  updateWeekItemFieldsAction,
  listProjectsForWeekItemAction,
} from "./actions";

const mockedSet = vi.mocked(setViewPreferences);
const mockedRevalidate = vi.mocked(revalidatePath);
const mockedUpdate = vi.mocked(updateWeekItemField);
const mockedLink = vi.mocked(linkWeekItemToProject);

beforeEach(() => {
  mockedSet.mockClear();
  mockedRevalidate.mockClear();
  mockedUpdate.mockClear();
  mockedLink.mockClear();
  mockedRow = undefined;
  mockedProjectsForClient = [];
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
  it("returns an error result when editorName is empty (defensive boundary, client gates via name prompt)", async () => {
    mockedRow = {
      id: "wi-x",
      title: "Anything",
      weekOf: "2026-06-01",
      status: "in-progress",
    };
    const result = await setWeekItemStatusAction({
      weekItemId: "wi-x",
      newStatus: "completed",
      editorName: "",
    });
    expect(result).toEqual({ ok: false, error: "Editor name is required." });
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("trims whitespace from editorName and rejects if blank after trim", async () => {
    mockedRow = {
      id: "wi-x",
      title: "Anything",
      weekOf: "2026-06-01",
      status: "in-progress",
    };
    const result = await setWeekItemStatusAction({
      weekItemId: "wi-x",
      newStatus: "completed",
      editorName: "   ",
    });
    expect(result).toEqual({ ok: false, error: "Editor name is required." });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("returns an error result when the row is not found", async () => {
    mockedRow = undefined;
    const result = await setWeekItemStatusAction({
      weekItemId: "missing",
      newStatus: "completed",
      editorName: "Jason",
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
      editorName: "Jason",
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
      editorName: "Jason",
    });
    expect(result).toEqual({ ok: false, error: "status enum invalid" });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("delegates to updateWeekItemField with editorName-suffixed updatedBy and returns previousStatus", async () => {
    mockedRow = {
      id: "wi-3",
      title: "Brand: Hero",
      weekOf: "2026-06-01",
      status: "in-progress",
    };
    const result = await setWeekItemStatusAction({
      weekItemId: "wi-3",
      newStatus: "completed",
      editorName: "Jason",
    });
    expect(mockedUpdate).toHaveBeenCalledWith({
      weekOf: "2026-06-01",
      weekItemTitle: "Brand: Hero",
      field: "status",
      newValue: "completed",
      updatedBy: "runway:dashboard:Jason",
      source: "dashboard",
    });
    expect(mockedRevalidate).toHaveBeenCalledWith("/runway");
    expect(result).toEqual({ ok: true, previousStatus: "in-progress" });
  });

  // #80 — the round-trip per-operator suffix is what makes the
  // updateWeekItemField idem-key distinct per operator+click. Without it,
  // two different operators clicking the same row would still collide
  // because both writes share (updateType, weekItemId, field, value).
  it("threads a distinct editorName suffix per operator so idem-key fingerprints don't collide", async () => {
    mockedRow = {
      id: "wi-3",
      title: "Brand: Hero",
      weekOf: "2026-06-01",
      status: "in-progress",
    };
    await setWeekItemStatusAction({
      weekItemId: "wi-3",
      newStatus: "completed",
      editorName: "Alice",
    });
    await setWeekItemStatusAction({
      weekItemId: "wi-3",
      newStatus: "completed",
      editorName: "Bob",
    });
    expect(mockedUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ updatedBy: "runway:dashboard:Alice" }),
    );
    expect(mockedUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ updatedBy: "runway:dashboard:Bob" }),
    );
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
      editorName: "Jason",
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

  // #84 — `category` is editable from the dashboard. The action routes it
  // through `updateWeekItemField` like any other string field and captures
  // the row's prior category so the modal's Undo can replay the inverse.
  it("routes category writes through updateWeekItemField and captures the prior category for Undo", async () => {
    mockedRow = {
      id: "wi-1",
      title: "Brand: Hero",
      weekOf: "2026-06-01",
      owner: "Lane",
      category: "delivery",
    };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { category: "review" },
    });
    expect(mockedUpdate).toHaveBeenCalledWith({
      weekOf: "2026-06-01",
      weekItemTitle: "Brand: Hero",
      field: "category",
      newValue: "review",
      updatedBy: "Jason",
      source: "dashboard",
    });
    expect(result).toEqual({
      ok: true,
      previousValues: { category: "delivery" },
    });
  });

  it("category clear writes null through updateWeekItemField (the dropdown's (clear) option)", async () => {
    mockedRow = {
      id: "wi-1",
      title: "Brand: Hero",
      weekOf: "2026-06-01",
      owner: "Lane",
      category: "delivery",
    };
    await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { category: null },
    });
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ field: "category", newValue: null }),
    );
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

  // P1.1 server validators (TP review on b7c89f3). Client modal is the
  // primary gate but cannot be trusted — drafters frequently title-case
  // dayOfWeek (`feedback_dayofweek_lowercase`); per
  // `feedback_sheet_authority_cuts_both_ways` server must enforce.
  it("rejects an empty title with a clear error before touching the DB", async () => {
    mockedRow = { id: "wi-1", title: "T", weekOf: "2026-06-01" };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { title: "   " },
    });
    expect(result).toEqual({ ok: false, error: "Title is required." });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an empty owner before touching the DB", async () => {
    mockedRow = { id: "wi-1", title: "T", weekOf: "2026-06-01" };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { owner: "" },
    });
    expect(result).toEqual({ ok: false, error: "Owner is required." });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("normalizes title-cased dayOfWeek to lowercase before writing", async () => {
    mockedRow = { id: "wi-1", title: "T", weekOf: "2026-06-01" };
    await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { dayOfWeek: "Tuesday" },
    });
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ field: "dayOfWeek", newValue: "tuesday" }),
    );
  });

  it("rejects a weekend dayOfWeek (Saturday / Sunday are not work-week values)", async () => {
    mockedRow = { id: "wi-1", title: "T", weekOf: "2026-06-01" };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { dayOfWeek: "saturday" },
    });
    expect(result.ok).toBe(false);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("routes projectId through linkWeekItemToProject (NOT updateWeekItemField) and returns previousProjectId", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      projectId: "p-old",
    };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: {},
      projectId: "p-new",
    });
    expect(mockedLink).toHaveBeenCalledWith({
      weekItemId: "wi-1",
      projectId: "p-new",
      updatedBy: "Jason",
    });
    expect(result).toEqual({
      ok: true,
      previousValues: {},
      previousProjectId: "p-old",
    });
  });

  it("skips linkWeekItemToProject when the requested projectId matches the current one", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      projectId: "p-same",
    };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: {},
      projectId: "p-same",
    });
    expect(mockedLink).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      previousValues: {},
      previousProjectId: "p-same",
    });
  });

  // P0 from TP code-review on 856b7dd: capturePreviousValue returns null
  // for any field that was historically null on the row. The dashboard
  // modal's Undo replays previousValues — if a WI had owner: null and the
  // operator sets owner: "Jill" then clicks Undo, the patch carries
  // { owner: null } and the validator must accept it (restoring the
  // historical state). Empty string still rejects (typo on a NEW edit).
  it("validator permits explicit null on owner (restores historical null via undo)", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      owner: "Jill",
    };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { owner: null },
    });
    expect(result.ok).toBe(true);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ field: "owner", newValue: null }),
    );
  });

  it("validator rejects empty-string owner (typo on a NEW edit, not undo)", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      owner: "Jill",
    };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { owner: "" },
    });
    expect(result).toEqual({ ok: false, error: "Owner is required." });
  });

  it("validator permits explicit null on dayOfWeek (restores historical null via undo)", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      dayOfWeek: "monday",
    };
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { dayOfWeek: null },
    });
    expect(result.ok).toBe(true);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ field: "dayOfWeek", newValue: null }),
    );
  });

  it("writes string fields BEFORE re-parenting (a field-write failure short-circuits before the project move)", async () => {
    mockedRow = {
      id: "wi-1",
      title: "T",
      weekOf: "2026-06-01",
      owner: "X",
      projectId: "p-old",
    };
    mockedUpdate.mockResolvedValueOnce({
      ok: false,
      error: "owner validator rejected",
    });
    const result = await updateWeekItemFieldsAction({
      weekItemId: "wi-1",
      updatedBy: "Jason",
      fields: { owner: "Jill" },
      projectId: "p-new",
    });
    expect(result).toEqual({ ok: false, error: "owner validator rejected" });
    expect(mockedLink).not.toHaveBeenCalled();
  });
});

// ─── listProjectsForWeekItemAction (commit 8b) ─────────────────────────────

describe("listProjectsForWeekItemAction", () => {
  it("returns ok:false when the week item row is not found", async () => {
    mockedRow = undefined;
    const result = await listProjectsForWeekItemAction({ weekItemId: "wi-1" });
    expect(result).toEqual({
      ok: false,
      error: "Week item 'wi-1' not found.",
    });
  });

  it("returns the client's projects filtered to non-terminal status, mapped to ProjectOption shape", async () => {
    mockedRow = { id: "wi-1", clientId: "c-1", weekOf: "2026-06-01", title: "T" };
    mockedProjectsForClient = [
      { id: "p-1", name: "Brand Refresh", parentProjectId: null, status: "in-production" },
      { id: "p-2", name: "Old Site", parentProjectId: null, status: "completed" },
      { id: "p-3", name: "Done", parentProjectId: null, status: "canceled" },
      { id: "p-4", name: "Hold", parentProjectId: null, status: "on-hold" },
    ];
    const result = await listProjectsForWeekItemAction({ weekItemId: "wi-1" });
    expect(result).toEqual({
      ok: true,
      projects: [
        { id: "p-1", name: "Brand Refresh", parentProjectId: null },
        { id: "p-4", name: "Hold", parentProjectId: null },
      ],
    });
  });

  it("preserves the helper's sortOrder by not re-sorting the list", async () => {
    mockedRow = { id: "wi-1", clientId: "c-1", weekOf: "2026-06-01", title: "T" };
    mockedProjectsForClient = [
      { id: "p-z", name: "Zeta", parentProjectId: null, status: "not-started" },
      { id: "p-a", name: "Alpha", parentProjectId: null, status: "in-production" },
    ];
    const result = await listProjectsForWeekItemAction({ weekItemId: "wi-1" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.projects.map((p) => p.id)).toEqual(["p-z", "p-a"]);
  });

  // P1.2 from TP code-review on 856b7dd: wrapper-children + L2-equivalent
  // sub-projects (parentProjectId != null) are NOT valid weekItem parents
  // from this picker. linkWeekItemToProject was previously relying on the
  // picker to filter; the only L2-host candidates are top-level projects.
  it("filters out projects with a parentProjectId (only top-level L1s + wrappers reach the picker)", async () => {
    mockedRow = { id: "wi-1", clientId: "c-1", weekOf: "2026-06-01", title: "T" };
    mockedProjectsForClient = [
      { id: "p-1", name: "Brand Refresh (L1)", parentProjectId: null, status: "in-production" },
      { id: "p-2", name: "Rewards Build (L2-equivalent)", parentProjectId: "p-1", status: "in-production" },
      { id: "p-3", name: "Burger Day LP (L1)", parentProjectId: null, status: "not-started" },
    ];
    const result = await listProjectsForWeekItemAction({ weekItemId: "wi-1" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.projects.map((p) => p.id)).toEqual(["p-1", "p-3"]);
  });
});
