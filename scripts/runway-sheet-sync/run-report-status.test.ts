import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRunReportStatus } from "./run-report-status";

let dir: string;
const locked: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "runway-report-status-"));
});
afterEach(() => {
  for (const p of locked.splice(0)) chmodSync(p, 0o644);
});

describe("readRunReportStatus", () => {
  it("reads the newest report by its date and calls a run with no ERROR line clean", () => {
    writeFileSync(join(dir, "diff-S1-2026-10-01.md"), "> **ERROR: ledger populated, nothing matched.**\n");
    writeFileSync(join(dir, "diff-S1-2026-10-20.md"), "## Summary\n");
    const status = readRunReportStatus(dir, "S1");
    expect(status).toEqual({ kind: "clean", path: join(dir, "diff-S1-2026-10-20.md") });
  });

  it("calls the newest report failed when it carries an ERROR line", () => {
    writeFileSync(join(dir, "diff-S1-2026-10-01.md"), "## Summary\n");
    writeFileSync(join(dir, "diff-S1-2026-10-20.md"), "> **ERROR: ledger populated, nothing matched.**\n");
    const status = readRunReportStatus(dir, "S1");
    expect(status.kind).toBe("failed");
  });

  it("ignores another sheet's report and the payloads file", () => {
    writeFileSync(join(dir, "diff-S2-2026-10-20.md"), "## Summary\n");
    writeFileSync(join(dir, "diff-S1-2026-10-20.payloads.json"), "{}\n");
    expect(readRunReportStatus(dir, "S1")).toEqual({ kind: "none" });
  });

  it("reads a missing report folder as no report, an absence", () => {
    expect(readRunReportStatus(join(dir, "nope"), "S1")).toEqual({ kind: "none" });
  });

  it("maps a refused read of the report file to could-not-tell", () => {
    const p = join(dir, "diff-S1-2026-10-20.md");
    writeFileSync(p, "## Summary\n");
    chmodSync(p, 0o000);
    locked.push(p);
    const status = readRunReportStatus(dir, "S1");
    expect(status.kind).toBe("could-not-tell");
    expect(status.kind === "could-not-tell" && status.reason).toMatch(/EACCES/);
  });
});
