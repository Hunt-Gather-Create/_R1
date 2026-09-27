import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runParity, computeParityRunId } from "./cli";
import type { SheetFixture } from "../types";
import type { ProdSnapshot } from "./types";

const SHEET_ID = "sheet-cli-test";

/** Minimal variant-A grid: banner rows, header row, one rollup, one leaf. */
const VALUES: (string | undefined)[][] = [
  ["", "CIVILIZATION"],
  [],
  ["", "Acme | Project Plan"],
  [],
  ["", "Widget Refresh  |   ACM-2601-01"],
  [],
  [],
  ["", "OVERALL PROGRESS"],
  [],
  ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE", "DURATION", "PREDECESSOR", "LAG", "RESOURCE", "STATUS", "DURATION", "DAYS LEFT", "%"],
  ["", "FALSE", "Widget Release", "", "1-Jun-2026", "30-Jun-2026"],
  ["", "TRUE", "   1.1 Kickoff call", "", "1-Jun-2026", "1-Jun-2026", "", "", "", "Civ + Acme"],
];

function fixture(): SheetFixture {
  return { sheetId: SHEET_ID, tab: "Task Tracker & Gantt Chart", range: "A1:N", exportedAt: "2026-09-07T21:20:00Z", values: VALUES };
}

function prodSnapshot(): ProdSnapshot {
  return {
    clientSlug: "acme",
    capturedAt: "2026-09-07T22:00:00Z",
    client: { id: "c-1", slug: "acme", name: "Acme" },
    projects: [{ id: "p-1", name: "Widget Refresh", status: null, category: null, notes: "ACM-2601-01" }],
    weekItems: [
      {
        id: "wi-1",
        projectId: "p-1",
        title: "Kickoff call",
        weekOf: "2026-06-01",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        status: "completed", // TRUE checkbox -> derivedStatus "completed", agrees
        category: null, // tool derives "kickoff" -> disagrees
        owner: "Lane", // tool never plans an owner -> disagrees
        resources: "CD: Lane", // tool never plans resources -> disagrees
        notes: null,
      },
    ],
  };
}

describe("runParity, the real CLI call site, not a re-implementation of it", () => {
  // _R1#185: this file's rmSync calls used to be the last statement of each
  // it, so a failed assertion above them skipped cleanup and leaked the temp
  // dir. afterEach removes whatever dir the test registered, so a red test
  // still cleans up, the same shape matched-counter.test.ts uses.
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("produces a verdict file and a markdown reader's aid from two frozen files", () => {
    dir = mkdtempSync(join(tmpdir(), "parity-cli-"));
    const sheetPath = join(dir, "sheet.json");
    const prodPath = join(dir, "prod.json");
    const outPath = join(dir, "verdict.json");
    writeFileSync(sheetPath, JSON.stringify(fixture()));
    writeFileSync(prodPath, JSON.stringify(prodSnapshot()));

    const result = runParity({
      sheetFixturePath: sheetPath,
      prodSnapshotPath: prodPath,
      engagementCode: "ACM-2601-01",
      label: "Widget Refresh",
      outPath,
    });

    expect(result.counts).toEqual({ AGREE: 0, DISAGREE: 1, TOOL_ONLY: 0, HAND_ONLY: 0 });
    expect(result.rows[0].mismatchedFields.map((f) => f.field).sort()).toEqual(["category", "owner", "resources"]);

    const onDisk = JSON.parse(readFileSync(outPath, "utf8"));
    expect(onDisk.runId).toBe(result.runId);
    expect(onDisk.interventions).toBe(result.interventions);
    const md = readFileSync(join(dir, "verdict.md"), "utf8");
    expect(md).toContain("DISAGREE");
    // _R1#156: interventions = HAND_ONLY + DISAGREE = 0 + 1 = 1, printed as
    // its own line, plus a measured wall-clock line and the honest
    // tokens-zero line, none of which touch the verdict.json above.
    expect(md).toContain("interventions: 1");
    expect(md).toMatch(/wall-clock: \d+ms/);
    expect(md).toContain("tokens: 0, no model in the path");
  });

  it("re-running on the identical two frozen files produces a byte-identical verdict file", () => {
    dir = mkdtempSync(join(tmpdir(), "parity-cli-rerun-"));
    const sheetPath = join(dir, "sheet.json");
    const prodPath = join(dir, "prod.json");
    const outPath = join(dir, "verdict.json");
    writeFileSync(sheetPath, JSON.stringify(fixture()));
    writeFileSync(prodPath, JSON.stringify(prodSnapshot()));
    const opts = { sheetFixturePath: sheetPath, prodSnapshotPath: prodPath, engagementCode: "ACM-2601-01", label: "Widget Refresh", outPath };

    runParity(opts);
    const first = readFileSync(outPath, "utf8");
    runParity(opts);
    const second = readFileSync(outPath, "utf8");
    expect(second).toBe(first);
  });

  it("rejects an --out path with no .json suffix instead of letting the markdown write clobber it", () => {
    dir = mkdtempSync(join(tmpdir(), "parity-cli-badout-"));
    const sheetPath = join(dir, "sheet.json");
    const prodPath = join(dir, "prod.json");
    writeFileSync(sheetPath, JSON.stringify(fixture()));
    writeFileSync(prodPath, JSON.stringify(prodSnapshot()));

    expect(() =>
      runParity({
        sheetFixturePath: sheetPath,
        prodSnapshotPath: prodPath,
        engagementCode: "ACM-2601-01",
        label: "Widget Refresh",
        outPath: join(dir, "verdict"), // no .json suffix
      })
    ).toThrow(/must end in \.json/);
  });

  it("computeParityRunId depends only on the two files' bytes, never on wall-clock time", () => {
    const a = computeParityRunId("sheet-bytes", "prod-bytes");
    const b = computeParityRunId("sheet-bytes", "prod-bytes");
    expect(a).toBe(b);
    const c = computeParityRunId("sheet-bytes-changed", "prod-bytes");
    expect(c).not.toBe(a);
  });
});
