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

import { setViewPreferences } from "@/lib/runway/view-preferences";
import { revalidatePath } from "next/cache";
import { toggleInFlightAction, toggleNeedsUpdateAction } from "./actions";

const mockedSet = vi.mocked(setViewPreferences);
const mockedRevalidate = vi.mocked(revalidatePath);

beforeEach(() => {
  mockedSet.mockClear();
  mockedRevalidate.mockClear();
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
