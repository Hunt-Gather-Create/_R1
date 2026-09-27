/**
 * _R1#154 item 2, RED first per TP's ruling on this ticket: this test
 * drives checkFreshness against a frozen Drive listing fixture. Acceptance
 * 1 must fail on e8af9aa's stub, which always reports fresh, the same as
 * today's real behavior: a run against ITEP's registered v1 sheet has
 * nothing that would ever refuse it, even though
 * BPC-2604_itep_Project-Plan-v2 sits right next to it with a newer
 * modifiedTime and a different engagement code.
 *
 * The fixture is a MINIMAL, hand-selected subset of a real 165-file Drive
 * search captured 2026-09-27, not the full result: both _R1 repos are
 * public, and the full capture includes other clients' plans, prospects,
 * and PENDING-CLEARANCE files with nothing to do with this tool. Only the
 * entries this ticket's tests need are here; see the fixture's own "note"
 * field for what was cut and why.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFreshness, type DriveFile } from "./freshness";
import type { SheetConfig } from "./types";

const FIXTURE_PATH = join(__dirname, "__fixtures__", "drive-listing-2026-09-27.json");

function loadListing(): DriveFile[] {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { files: DriveFile[] };
  return raw.files;
}

describe("checkFreshness (_R1#154 item 2), against the minimal frozen Drive listing fixture", () => {
  const listing = loadListing();

  it("fixture sanity: the minimal listing has exactly 15 entries, real plus synthetic", () => {
    expect(listing.length).toBe(15);
  });

  it("acceptance 1: the registered ITEP v1 sheet is refused, naming BPC-2604_itep_Project-Plan-v2, its id, and the code change from BPC-2603-01 to BPC-2604", () => {
    const itepConfig: SheetConfig = {
      sheetId: "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog",
      clientSlug: "beyond-petro",
      engagementCode: "BPC-2603-01",
      label: "ITEP Landing Page",
      planSlug: "itep",
    };

    const result = checkFreshness(itepConfig, listing);

    expect(result.fresh).toBe(false);
    expect(result.sibling?.id).toBe("1cS5yxsnNlXiMX84CwAUBpyEueEph__RmIrf9OTUmtgM");
    expect(result.sibling?.name).toBe("BPC-2604_itep_Project-Plan-v2");
    expect(result.reason).toMatch(/BPC-2604_itep_Project-Plan-v2/);
    expect(result.reason).toMatch(/BPC-2603-01/);
    expect(result.reason).toMatch(/BPC-2604/);
  });

  it("negative control: the registered Spilltracker entry, already pointing at its v2, is NOT refused, even though the older v1 sibling is in the listing", () => {
    const spilltrackerConfig: SheetConfig = {
      sheetId: "1JuPXk46yjAAav8fu7U6CEg8ILLd9TzALcmZYeGE3XOk",
      clientSlug: "beyond-petro",
      engagementCode: "BPC-2602-01",
      label: "Spilltracker Website Refresh",
      planSlug: "spilltracker",
    };

    // Confirm the older sibling really is in the listing this fixture uses,
    // so a pass here is not just an empty fixture accident.
    expect(listing.some((f) => f.name === "BPC-2602_spilltracker_Project-Plan-v1")).toBe(true);

    const result = checkFreshness(spilltrackerConfig, listing);
    expect(result.fresh).toBe(true);
  });

  it("mutation control: matching siblings on the FULL engagement code instead of client prefix plus slug loses ITEP's v2 sibling entirely (acceptance 1 goes green without refusing)", () => {
    // Reproduces the exact defect this ticket exists for: a freshness check
    // that matches on the full code misses ITEP's v2, which carries a
    // DIFFERENT full code, BPC-2604, than the registered BPC-2603-01. Only
    // the client prefix, BPC, and the slug, itep, are shared.
    function checkFreshnessByFullCode(config: SheetConfig, entries: DriveFile[]): { fresh: boolean } {
      const registeredEntry = entries.find((f) => f.id === config.sheetId);
      const registeredVersion = registeredEntry
        ? Number(registeredEntry.name.match(/v(\d+)$/)?.[1] ?? 0)
        : 0;
      for (const file of entries) {
        if (file.id === config.sheetId) continue;
        if (!file.name.includes(config.engagementCode)) continue;
        const version = Number(file.name.match(/v(\d+)$/)?.[1] ?? 0);
        if (version > registeredVersion) return { fresh: false };
      }
      return { fresh: true };
    }

    const itepConfig: SheetConfig = {
      sheetId: "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog",
      clientSlug: "beyond-petro",
      engagementCode: "BPC-2603-01",
      label: "ITEP Landing Page",
      planSlug: "itep",
    };

    const byFullCode = checkFreshnessByFullCode(itepConfig, listing);
    expect(byFullCode.fresh).toBe(true); // RED here: misses the sibling, the defect this ticket closes

    const byPrefixAndSlug = checkFreshness(itepConfig, listing);
    expect(byPrefixAndSlug.fresh).toBe(false); // the real implementation catches it
  });

  it("TP's follow-up on 7243643: a registry entry with no planSlug refuses, naming the sheet, rather than reporting fresh with nothing checked", () => {
    const noSlugConfig: SheetConfig = {
      sheetId: "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog",
      clientSlug: "beyond-petro",
      engagementCode: "BPC-2603-01",
      label: "ITEP Landing Page",
      // planSlug omitted on purpose: this is the case under test.
    };

    const result = checkFreshness(noSlugConfig, listing);

    expect(result.fresh).toBe(false);
    expect(result.reason).toMatch(/1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog/);
    expect(result.reason).toMatch(/ITEP Landing Page/);
    expect(result.reason).toMatch(/planSlug/);
    expect(result.reason).toMatch(/--skip-freshness-check/);
  });

  it("TP's second follow-up on 9a950bd: a registered id absent from the whole listing refuses, naming the sheet, rather than falling through to 'no sibling found, fresh'", () => {
    const noSiblingsAtAll: DriveFile[] = [
      { id: "some-other-sheet-id", name: "ZZZ-1234_unrelated_Project-Plan-v1", modifiedTime: "2026-01-01T00:00:00Z" },
    ];
    const missingConfig: SheetConfig = {
      sheetId: "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog",
      clientSlug: "beyond-petro",
      engagementCode: "BPC-2603-01",
      label: "ITEP Landing Page",
      planSlug: "itep",
    };

    const result = checkFreshness(missingConfig, noSiblingsAtAll);

    expect(result.fresh).toBe(false);
    expect(result.reason).toMatch(/1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog/);
    expect(result.reason).toMatch(/ITEP Landing Page/);
    expect(result.reason).toMatch(/--skip-freshness-check/);
  });

  it("the same absent-id refusal fires even when a sibling WOULD otherwise match: absence is checked before any sibling comparison, so the reason names the absence, not a sibling", () => {
    const listingWithAMatchingSibling: DriveFile[] = [
      { id: "1cS5yxsnNlXiMX84CwAUBpyEueEph__RmIrf9OTUmtgM", name: "BPC-2604_itep_Project-Plan-v2", modifiedTime: "2026-08-27T04:01:14.936Z" },
    ];
    const missingConfig: SheetConfig = {
      sheetId: "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog",
      clientSlug: "beyond-petro",
      engagementCode: "BPC-2603-01",
      label: "ITEP Landing Page",
      planSlug: "itep",
    };

    const result = checkFreshness(missingConfig, listingWithAMatchingSibling);

    expect(result.fresh).toBe(false);
    expect(result.sibling).toBeUndefined();
    expect(result.reason).toMatch(/1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog/);
    expect(result.reason).not.toMatch(/BPC-2604_itep_Project-Plan-v2/);
  });

  // TP's gate-2 finding, upheld by Overwatch: the existing full-code mutation
  // control removes BOTH the client-prefix and planSlug comparisons at once,
  // so it never proved either half on its own. On the committed fixture,
  // dropping the slug check alone still passed acceptance 1 (BPC-2604 is the
  // first newer BPC file in fixture order, not because the slug matched),
  // and dropping the prefix check alone also still passed (no other client
  // in the fixture shares a slug). These two tests pin each half separately,
  // with synthetic entries so nothing new and real is added to the public
  // fixture.
  describe("TP's gate-2 finding: pinning client prefix and planSlug as two SEPARATE conditions, not one combined one", () => {
    const planA: SheetConfig = {
      sheetId: "synthetic-planA-id",
      clientSlug: "acme",
      engagementCode: "ACM-2601-01",
      label: "Plan A",
      planSlug: "plan-a",
    };
    const planB: SheetConfig = {
      sheetId: "synthetic-planB-id",
      clientSlug: "acme",
      engagementCode: "ACM-2602-01",
      label: "Plan B",
      planSlug: "plan-b",
    };
    const sameClientTwoPlans: DriveFile[] = [
      { id: planA.sheetId, name: "ACM-2601-01_plan-a_Project-Plan-v1", modifiedTime: "2026-01-01T00:00:00Z" },
      { id: planB.sheetId, name: "ACM-2602-01_plan-b_Project-Plan-v1", modifiedTime: "2026-01-01T00:00:00Z" },
      { id: "synthetic-planA-v2-id", name: "ACM-2601-01_plan-a_Project-Plan-v2", modifiedTime: "2026-02-01T00:00:00Z" },
    ];

    const planC: SheetConfig = {
      sheetId: "synthetic-planC-id",
      clientSlug: "zenith",
      engagementCode: "ZEN-2601-01",
      label: "Plan C",
      planSlug: "shared-slug",
    };
    const sameSlugOtherClient: DriveFile[] = [
      { id: planC.sheetId, name: "ZEN-2601-01_shared-slug_Project-Plan-v1", modifiedTime: "2026-01-01T00:00:00Z" },
      { id: "synthetic-other-slug-id", name: "OTH-2601-01_shared-slug_Project-Plan-v2", modifiedTime: "2026-02-01T00:00:00Z" },
    ];

    it("test 1, SAME CLIENT TWO PLANS: plan A refuses naming its own v2 sibling, plan B (same prefix, different slug) stays fresh", () => {
      const resultA = checkFreshness(planA, sameClientTwoPlans);
      expect(resultA.fresh).toBe(false);
      expect(resultA.sibling?.id).toBe("synthetic-planA-v2-id");

      const resultB = checkFreshness(planB, sameClientTwoPlans);
      expect(resultB.fresh).toBe(true);
    });

    it("test 2, SAME SLUG OTHER CLIENT: plan C stays fresh even though a newer file under a DIFFERENT client prefix shares its exact slug", () => {
      const resultC = checkFreshness(planC, sameSlugOtherClient);
      expect(resultC.fresh).toBe(true);
    });

    it("order independence: reversing the listing array changes nothing, for ITEP's own refusal or either synthetic case, proving no result here rides on fixture order", () => {
      const itepConfig: SheetConfig = {
        sheetId: "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog",
        clientSlug: "beyond-petro",
        engagementCode: "BPC-2603-01",
        label: "ITEP Landing Page",
        planSlug: "itep",
      };
      const reversedMainListing = [...listing].reverse();
      expect(checkFreshness(itepConfig, reversedMainListing).fresh).toBe(false);
      expect(checkFreshness(itepConfig, reversedMainListing).sibling?.id).toBe(
        "1cS5yxsnNlXiMX84CwAUBpyEueEph__RmIrf9OTUmtgM",
      );

      const reversedTwoPlans = [...sameClientTwoPlans].reverse();
      expect(checkFreshness(planA, reversedTwoPlans).fresh).toBe(false);
      expect(checkFreshness(planB, reversedTwoPlans).fresh).toBe(true);

      const reversedSameSlug = [...sameSlugOtherClient].reverse();
      expect(checkFreshness(planC, reversedSameSlug).fresh).toBe(true);
    });
  });
});
