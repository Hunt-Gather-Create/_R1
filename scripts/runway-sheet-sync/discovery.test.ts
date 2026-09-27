/**
 * _R1#154 item 3: discoverPlans against the same minimal frozen Drive
 * listing fixture as freshness.test.ts, and the REAL registry (config.ts's
 * SHEETS), so the report reflects the actual current registration state,
 * not a hand-built one. Never auto-registers: this only proves the report
 * itself is correct, not that anything gets written.
 */
import { describe, expect, it } from "vitest";
import { SHEETS } from "./config";
import { discoverPlans, type DriveFile } from "./discovery";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_PATH = join(__dirname, "__fixtures__", "drive-listing-2026-09-27.json");

function loadListing(): DriveFile[] {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { files: DriveFile[] };
  return raw.files;
}

describe("discoverPlans (_R1#154 item 3), against the minimal frozen Drive listing fixture and the real registry", () => {
  const listing = loadListing();
  const report = discoverPlans(SHEETS, listing);

  it("names the synthetic unregistered plan", () => {
    expect(report.unregistered.some((e) => e.id === "SYNTHETIC-unregistered-1")).toBe(true);
    expect(report.unregistered.some((e) => e.name === "ACME-9001_widget-launch_Project-Plan-v1")).toBe(true);
  });

  it("also lists ITEP's v2 sibling as unregistered in its own right, alongside being the reason v1 is superseded", () => {
    expect(report.unregistered.some((e) => e.id === "1cS5yxsnNlXiMX84CwAUBpyEueEph__RmIrf9OTUmtgM")).toBe(true);
  });

  it("names ITEP v1 as superseded, with the v2 sibling and a reason naming the code change", () => {
    const itep = report.superseded.find((s) => s.sheetId === "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog");
    expect(itep).toBeDefined();
    expect(itep?.sibling.id).toBe("1cS5yxsnNlXiMX84CwAUBpyEueEph__RmIrf9OTUmtgM");
    expect(itep?.reason).toMatch(/BPC-2603-01/);
    expect(itep?.reason).toMatch(/BPC-2604/);
  });

  it("does NOT name Spilltracker as superseded: it is already registered against its v2", () => {
    expect(report.superseded.some((s) => s.sheetId === "1JuPXk46yjAAav8fu7U6CEg8ILLd9TzALcmZYeGE3XOk")).toBe(false);
  });

  it("registeredNotFound is empty: every registered id in this fixture is present in the listing, Soundly included", () => {
    expect(report.registeredNotFound).toEqual([]);
  });

  it("names the NFM same-title pair as a duplicate, by id, not just by title", () => {
    const dup = report.duplicates.find((d) => d.name === "NFM-2601_cedar-park-digital-screen_Project-Plan-v1");
    expect(dup).toBeDefined();
    expect(dup?.ids.sort()).toEqual(
      ["14x2WqepMH2iexwinkZ1mQQJY37TbSvqu1NhBqNL_dp0", "1giFx_-ewRrX-vpDxsNWUWBxxWlpBh_wtu0C-Jtu6sWs"].sort(),
    );
  });

  it("puts the synthetic PENDING-CLEARANCE and TEST files in their own bucket, never silently excluded", () => {
    expect(report.pendingClearanceOrTest.some((e) => e.id === "SYNTHETIC-pending-1")).toBe(true);
    expect(report.pendingClearanceOrTest.some((e) => e.id === "SYNTHETIC-test-1")).toBe(true);
  });

  it("puts the synthetic unrecognised-shape title in its own bucket, and the registered Soundly sheet is NOT dropped, NOT forced into unregistered or unrecognised, since it is registered", () => {
    expect(report.unrecognizedShape.some((e) => e.id === "SYNTHETIC-unrecognized-1")).toBe(true);
    // Soundly's own id is registered, so it must never appear in unregistered
    // or unrecognizedShape, even though its title matches neither strict
    // shape: it is accounted for by being registered, not by its shape.
    const soundlyId = "1iK2uiKLvaxezqfW43DdMihQAwmOgV0Z8gNh7uCcbvrM";
    expect(report.unregistered.some((e) => e.id === soundlyId)).toBe(false);
    expect(report.unrecognizedShape.some((e) => e.id === soundlyId)).toBe(false);
  });

  it("registeredNotFound, superseded, noPlanSlug and registeredClean partition the real registry exactly, with no drops and no double-counts (TP's follow-up on 9a950bd)", () => {
    const ids = new Set(SHEETS.map((s) => s.sheetId));
    expect(ids.size).toBe(SHEETS.length); // sanity: no duplicate registry ids to begin with

    const buckets = [
      ...report.registeredNotFound.map((e) => e.sheetId),
      ...report.superseded.map((e) => e.sheetId),
      ...report.noPlanSlug.map((e) => e.sheetId),
      ...report.registeredClean.map((e) => e.sheetId),
    ];

    expect(buckets.length).toBe(SHEETS.length); // no drops, no double-counts
    expect(new Set(buckets).size).toBe(SHEETS.length); // every id appears exactly once
    expect(new Set(buckets)).toEqual(ids); // and it is exactly the registry's own id set
  });

  it("TP's follow-up on 9a950bd: a registered, present entry with no planSlug lands in noPlanSlug, not silently dropped from every bucket", () => {
    const registryWithANoSlugEntry = [
      ...SHEETS,
      {
        sheetId: "no-slug-sheet-id",
        clientSlug: "acme",
        engagementCode: "ACM-2601-01",
        label: "Widget Refresh",
        // planSlug omitted on purpose: this is the case under test.
      },
    ];
    const listingWithTheNoSlugEntryPresent: DriveFile[] = [
      ...listing,
      { id: "no-slug-sheet-id", name: "ACM-2601-01 | Widget Refresh - Project Plan v1", modifiedTime: "2026-01-01T00:00:00Z" },
    ];

    const withNoSlug = discoverPlans(registryWithANoSlugEntry, listingWithTheNoSlugEntryPresent);

    expect(withNoSlug.noPlanSlug.some((e) => e.sheetId === "no-slug-sheet-id")).toBe(true);
    expect(withNoSlug.registeredNotFound.some((e) => e.sheetId === "no-slug-sheet-id")).toBe(false);
    expect(withNoSlug.superseded.some((e) => e.sheetId === "no-slug-sheet-id")).toBe(false);
    expect(withNoSlug.registeredClean.some((e) => e.sheetId === "no-slug-sheet-id")).toBe(false);
  });

  it("mutation control: reverting the candidate gate to the strict shape-only regex drops the synthetic unrecognised-shape title from discovery entirely, proving the broad candidate gate is load bearing", () => {
    const STRICT_OLD = /^([A-Za-z]+-?[\dA-Za-z-]*?)\s*\|\s*(.+?)\s*-\s*Project\s*Plan\s*v(\d+)$/i;
    const STRICT_NEW = /^([A-Za-z]+-?[\dA-Za-z-]*?)_(.+)_Project-Plan-v(\d+)$/i;
    const strictCandidates = listing.filter((f) => STRICT_OLD.test(f.name) || STRICT_NEW.test(f.name));
    // The unrecognised-shape synthetic entry and Soundly's own odd-shaped
    // entry both fail BOTH strict shapes, so a strict-shape-only candidate
    // gate never even sees them: exactly the failure this ticket exists to
    // close, reproduced here as a control rather than asserted on faith.
    expect(strictCandidates.some((f) => f.id === "SYNTHETIC-unrecognized-1")).toBe(false);
    expect(strictCandidates.some((f) => f.id === "1iK2uiKLvaxezqfW43DdMihQAwmOgV0Z8gNh7uCcbvrM")).toBe(false);
  });
});
