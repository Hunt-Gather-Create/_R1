import { describe, expect, it } from "vitest";
import { homedir } from "os";
import { join } from "path";
import {
  buildOutputPath,
  localISODate,
  parseArgs,
  slugify,
} from "./runway-gantt";

// ── parseArgs ────────────────────────────────────────────

describe("parseArgs", () => {
  it("returns project mode when --project is provided", () => {
    expect(parseArgs(["--project", "AG1"])).toEqual({
      ok: true,
      mode: "project",
      value: "AG1",
    });
  });

  it("returns client mode when --client is provided", () => {
    expect(parseArgs(["--client", "Convergix"])).toEqual({
      ok: true,
      mode: "client",
      value: "Convergix",
    });
  });

  it("rejects when neither flag is present", () => {
    const result = parseArgs([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Provide either --project or --client/);
  });

  it("rejects when both flags are present", () => {
    const result = parseArgs(["--project", "X", "--client", "Y"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/mutually exclusive/);
  });

  it("rejects when --project has no value", () => {
    const result = parseArgs(["--project"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Missing value after --project/);
  });

  it("rejects when --project is followed by another flag", () => {
    const result = parseArgs(["--project", "--client", "X"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Missing value after --project/);
  });

  it("rejects unknown flags", () => {
    const result = parseArgs(["--garbage"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown flag '--garbage'/);
  });

  it("preserves quoted multi-word values", () => {
    expect(parseArgs(["--project", "Website Build"])).toEqual({
      ok: true,
      mode: "project",
      value: "Website Build",
    });
  });
});

// ── slugify ──────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("Website Build")).toBe("website-build");
  });

  it("strips parentheses and other punctuation", () => {
    expect(slugify("New Capacity (PPT, brochure, one-pager)")).toBe(
      "new-capacity-ppt-brochure-one-pager",
    );
  });

  it("collapses runs of non-alphanumeric to a single hyphen", () => {
    expect(slugify("AG1 / PRO -- Content")).toBe("ag1-pro-content");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("-- weird name ")).toBe("weird-name");
  });

  it("returns an empty string when input has no alphanumerics", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("preserves digits", () => {
    expect(slugify("1H Convergix Retainer")).toBe("1h-convergix-retainer");
  });
});

// ── buildOutputPath ──────────────────────────────────────

describe("buildOutputPath", () => {
  it("assembles slug-slug-date filename under ~/runway-gantts/", () => {
    const path = buildOutputPath("High Desert Law", "Website Build", "2026-04-29");
    expect(path).toBe(
      join(homedir(), "runway-gantts", "high-desert-law-website-build-2026-04-29.html"),
    );
  });

  it("handles names with punctuation correctly", () => {
    const path = buildOutputPath(
      "Convergix",
      "AUTOMATE 2026 Booth Design",
      "2026-04-29",
    );
    expect(path).toBe(
      join(
        homedir(),
        "runway-gantts",
        "convergix-automate-2026-booth-design-2026-04-29.html",
      ),
    );
  });
});

// ── localISODate ─────────────────────────────────────────

describe("localISODate", () => {
  it("returns YYYY-MM-DD format", () => {
    const out = localISODate(new Date("2026-04-15T12:00:00Z"), "UTC");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).toBe("2026-04-15");
  });

  it("uses local timezone — boundary case proves it does not silently use UTC", () => {
    // 2026-04-29 03:00 UTC is still 2026-04-28 23:00 in America/New_York
    const instant = new Date("2026-04-29T03:00:00Z");
    expect(localISODate(instant, "America/New_York")).toBe("2026-04-28");
    expect(localISODate(instant, "UTC")).toBe("2026-04-29");
  });

  it("rolls forward correctly past local midnight", () => {
    // 2026-04-29 06:00 UTC = 2026-04-29 02:00 in America/New_York
    const instant = new Date("2026-04-29T06:00:00Z");
    expect(localISODate(instant, "America/New_York")).toBe("2026-04-29");
  });

  it("handles a timezone east of UTC (Asia/Tokyo)", () => {
    // 2026-04-28 16:00 UTC = 2026-04-29 01:00 in Tokyo
    const instant = new Date("2026-04-28T16:00:00Z");
    expect(localISODate(instant, "Asia/Tokyo")).toBe("2026-04-29");
    expect(localISODate(instant, "UTC")).toBe("2026-04-28");
  });
});
