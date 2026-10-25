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

describe("readRunReportStatus with refusal records", () => {
  const report = (at: string) => `# Runway Sheet Sync\n\n- Run: \`abc\` at ${at}\n\n## Summary\n`;
  const refusal = "> **ERROR: refused before the diff.** Sheet S1: title code X disagrees\n";

  it("calls a refusal newer than the same-day clean report failed, with its message", () => {
    writeFileSync(join(dir, "diff-S1-2026-10-20.md"), report("2026-10-20T09:00:00.000Z"));
    writeFileSync(join(dir, "refused-S1-2026-10-20T10-00-00.000Z.md"), refusal);
    expect(readRunReportStatus(dir, "S1")).toEqual({
      kind: "failed",
      path: join(dir, "refused-S1-2026-10-20T10-00-00.000Z.md"),
      reason: "ERROR: refused before the diff. Sheet S1: title code X disagrees",
    });
  });

  it("calls a same-day clean report newer than the refusal clean", () => {
    writeFileSync(join(dir, "refused-S1-2026-10-20T10-00-00.000Z.md"), refusal);
    writeFileSync(join(dir, "diff-S1-2026-10-20.md"), report("2026-10-20T11:00:00.000Z"));
    expect(readRunReportStatus(dir, "S1")).toEqual({ kind: "clean", path: join(dir, "diff-S1-2026-10-20.md") });
  });

  it("calls a refusal with no report beside it failed", () => {
    writeFileSync(join(dir, "refused-S1-2026-10-20T10-00-00.000Z.md"), refusal);
    expect(readRunReportStatus(dir, "S1").kind).toBe("failed");
  });

  it("lets a same-day refusal win over a report with no run time", () => {
    writeFileSync(join(dir, "diff-S1-2026-10-20.md"), "## Summary\n");
    writeFileSync(join(dir, "refused-S1-2026-10-20T00-00-01.000Z.md"), refusal);
    expect(readRunReportStatus(dir, "S1").kind).toBe("failed");
  });

  it("ignores another sheet's refusal record", () => {
    writeFileSync(join(dir, "diff-S1-2026-10-20.md"), report("2026-10-20T09:00:00.000Z"));
    writeFileSync(join(dir, "refused-S2-2026-10-21T10-00-00.000Z.md"), refusal);
    expect(readRunReportStatus(dir, "S1").kind).toBe("clean");
  });

  it("maps a refused read of the refusal record to could-not-tell", () => {
    const p = join(dir, "refused-S1-2026-10-20T10-00-00.000Z.md");
    writeFileSync(p, refusal);
    chmodSync(p, 0o000);
    locked.push(p);
    expect(readRunReportStatus(dir, "S1").kind).toBe("could-not-tell");
  });
});
