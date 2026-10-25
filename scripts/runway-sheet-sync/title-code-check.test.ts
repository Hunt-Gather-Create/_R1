/**
 * _R1#195 unit tests for the title code check. title-code-run.test.ts
 * proves the call site; this file proves the rule itself against synthetic
 * names and jobs.
 */
import { describe, expect, it } from "vitest";
import { driveFile } from "./schedule.test-fixtures";
import type { DriveFile } from "./schedule-files";
import { checkTitleCode, titleCode } from "./title-code-check";
import type { SheetConfig } from "./types";

const WIDGET: SheetConfig = { sheetId: "syn-widget", clientSlug: "acme-widgets", engagementCode: "ACW-2603-01", label: "Widget Page" };
const PINNED: SheetConfig = {
  sheetId: "syn-pinned",
  clientSlug: "globex",
  engagementCode: "GLX-2603",
  label: "Pinned Rebuild",
  fromRegistry: true,
};

const named = (id: string, name: string): DriveFile[] => [driveFile(id, name)];

describe("titleCode", () => {
  it("reads the leading code from all three title shapes in Drive", () => {
    expect(titleCode("ACW-2603-01 | Widget Page - Project Plan v1")).toBe("ACW-2603-01");
    expect(titleCode("ACW-2602_widget-refresh_Project-Plan-v2")).toBe("ACW-2602");
    expect(titleCode("GLX-2602 | Pinned Rebuild | Project Plan v1")).toBe("GLX-2602");
  });

  it("returns null when the name does not start with a code", () => {
    expect(titleCode("Pinned Rebuild Project Plan")).toBeNull();
  });
});

describe("checkTitleCode", () => {
  it("agrees, with no note, when the title starts with the job number", () => {
    expect(checkTitleCode(WIDGET, named(WIDGET.sheetId, "ACW-2603-01 | Widget Page - Project Plan v1"))).toBeNull();
  });

  it("treats a title code without the job's two-digit sub-number as the same engagement", () => {
    expect(checkTitleCode(WIDGET, named(WIDGET.sheetId, "ACW-2603_widget_Project-Plan-v1"))).toBeNull();
  });

  it("stops on a different engagement even when only the sub-number differs", () => {
    expect(() => checkTitleCode(WIDGET, named(WIDGET.sheetId, "ACW-2603-02 | Widget Page - Project Plan v1"))).toThrow(
      /title code ACW-2603-02 disagrees with job number ACW-2603-01/,
    );
  });

  it("rule 5: a sheet a sheet_registry row chose passes its old title code, with a note saying so", () => {
    const listing = named(PINNED.sheetId, "GLX-2602 | Pinned Rebuild | Project Plan v1");
    expect(checkTitleCode(PINNED, listing)).toMatch(/GLX-2602 != job number GLX-2603, accepted because a sheet_registry row/);
    expect(() => checkTitleCode({ ...PINNED, fromRegistry: undefined }, listing)).toThrow(/GLX-2602.*sheet_registry row for GLX-2603/);
  });

  it("does not let a registry row for one sheet pass another sheet", () => {
    expect(() => checkTitleCode(WIDGET, named(WIDGET.sheetId, "GLX-2602 | Pinned Rebuild | Project Plan v1"))).toThrow(
      /title code GLX-2602 disagrees with job number ACW-2603-01/,
    );
  });

  it("says loudly when there is no listing or no code to compare, rather than reading as a pass", () => {
    expect(checkTitleCode(WIDGET, null)).toMatch(/^TITLE CODE NOT CHECKED: no Drive listing entry/);
    expect(checkTitleCode(WIDGET, named(WIDGET.sheetId, "Widget Page - Project Plan v1"))).toMatch(
      /^TITLE CODE NOT CHECKED: no engagement code/,
    );
  });
});
