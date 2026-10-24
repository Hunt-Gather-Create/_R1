/**
 * _R1#195 unit tests for the title code check. title-code-run.test.ts
 * proves the call site; this file proves the rule itself against synthetic
 * names and the frozen 2026-09-27 Drive listing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getSheetConfig } from "./config";
import type { DriveFile } from "./freshness";
import { checkTitleCode, titleCode } from "./title-code-check";

const FROZEN = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "drive-listing-2026-09-27.json"), "utf8"),
) as { files: DriveFile[] };

const ITEP = getSheetConfig("1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog")!;
const SOUNDLY = getSheetConfig("1iK2uiKLvaxezqfW43DdMihQAwmOgV0Z8gNh7uCcbvrM")!;

function named(id: string, name: string): DriveFile[] {
  return [{ id, name, modifiedTime: "2026-09-27T00:00:00Z" }];
}

describe("titleCode", () => {
  it("reads the leading code from all three title shapes in Drive", () => {
    expect(titleCode("BPC-2603-01 | ITEP Landing Page - Project Plan v1")).toBe("BPC-2603-01");
    expect(titleCode("BPC-2602_spilltracker_Project-Plan-v2")).toBe("BPC-2602");
    expect(titleCode("SND-2602 | RX Card Rebuild | Project Plan v1")).toBe("SND-2602");
  });

  it("returns null when the name does not start with a code", () => {
    expect(titleCode("RX Card Rebuild Project Plan")).toBeNull();
  });
});

describe("checkTitleCode", () => {
  it("agrees, with no note, for every registered sheet in the frozen listing whose title matches its code", () => {
    const ids = [
      ITEP.sheetId,
      "1JuPXk46yjAAav8fu7U6CEg8ILLd9TzALcmZYeGE3XOk",
      "1lt-Guu94c-mBvHdNVjHLwDHP0CstxDLBOMpop1he-Cw",
      "1Ly8koIAYw2IvU_3YC4vouoVjoy8yIlVSIlsf8mfs4pg",
      "1agy2J6fIddCjn-HNt_exxIIm1AV-ZOREEYPwr_AngmI",
    ];
    for (const id of ids) expect(checkTitleCode(getSheetConfig(id)!, FROZEN.files)).toBeNull();
  });

  it("treats a title code without the registry's two-digit sub-number as the same engagement", () => {
    expect(checkTitleCode(ITEP, named(ITEP.sheetId, "BPC-2603_itep_Project-Plan-v1"))).toBeNull();
  });

  it("stops on a different engagement even when only the sub-number differs", () => {
    expect(() => checkTitleCode(ITEP, named(ITEP.sheetId, "BPC-2603-02 | ITEP Landing Page - Project Plan v1"))).toThrow(
      /title code BPC-2603-02 disagrees with registry code BPC-2603-01/,
    );
  });

  it("accepts Soundly's SND-2602 only through its written exception, and returns a note saying so", () => {
    expect(SOUNDLY.acceptedTitleCodes).toEqual(["SND-2602"]);
    expect(checkTitleCode(SOUNDLY, FROZEN.files)).toMatch(/SND-2602 != registry code SND-2603, accepted by a known exception/);
    expect(() => checkTitleCode({ ...SOUNDLY, acceptedTitleCodes: undefined }, FROZEN.files)).toThrow(/SND-2602/);
  });

  it("does not let one sheet's exception pass another sheet", () => {
    expect(() => checkTitleCode(ITEP, named(ITEP.sheetId, "SND-2602 | RX Card Rebuild | Project Plan v1"))).toThrow(
      /title code SND-2602 disagrees with registry code BPC-2603-01/,
    );
  });

  it("says loudly when there is no listing or no code to compare, rather than reading as a pass", () => {
    expect(checkTitleCode(ITEP, null)).toMatch(/^TITLE CODE NOT CHECKED: no Drive listing entry/);
    expect(checkTitleCode(ITEP, named(ITEP.sheetId, "ITEP Landing Page - Project Plan v1"))).toMatch(
      /^TITLE CODE NOT CHECKED: no engagement code/,
    );
  });
});
