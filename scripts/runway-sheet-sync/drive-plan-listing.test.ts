/**
 * listDrivePlanSheets against stub CLIs that stand in for the google-api
 * cli.js. Never the real CLI and never a real Drive call.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCoverage } from "./coverage";
import { DRIVE_PLAN_QUERY, listDrivePlanSheets } from "./drive-plan-listing";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "runway-drive-stub-"));
});

// The stub answers by page token and appends each argv to calls.jsonl.
function stub(pages: Record<string, unknown>): string {
  const path = join(dir, "cli.cjs");
  const log = join(dir, "calls.jsonl");
  writeFileSync(
    path,
    `const fs = require("fs");
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + "\\n");
const opts = JSON.parse(argv[2] || "{}");
const pages = ${JSON.stringify(pages)};
const page = pages[opts.pageToken || "first"];
if (page === "fail") { process.stderr.write("403 insufficient permissions"); process.exit(1); }
process.stdout.write(JSON.stringify(page));
`
  );
  return path;
}

// A stub that filters like Drive: a file is returned when its name holds any
// "name contains" term in the query it was given.
function queryStub(files: { id: string; name: string; modifiedTime: string }[]): string {
  const path = join(dir, "query-cli.cjs");
  writeFileSync(
    path,
    `const terms = [...process.argv[3].matchAll(/name contains '([^']*)'/g)].map((m) => m[1]);
const files = ${JSON.stringify(files)}.filter((f) => terms.some((t) => f.name.includes(t)));
process.stdout.write(JSON.stringify({ files, nextPageToken: null }));
`
  );
  return path;
}

const calls = (): string[][] =>
  readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);

const f = (id: string) => ({ id, name: `${id}_Project-Plan-v1`, modifiedTime: "2026-10-01T00:00:00.000Z" });

describe("listDrivePlanSheets", () => {
  it("runs drive:search with the plan query as the runway-sheet-sync consumer and pages to exhaustion", async () => {
    const cliPath = stub({
      first: { files: [f("A"), f("B")], nextPageToken: "p2" },
      p2: { files: [f("C")], nextPageToken: null },
    });
    const files = await listDrivePlanSheets({ cliPath });
    expect(files.map((x) => x.id)).toEqual(["A", "B", "C"]);
    const argv = calls();
    expect(argv).toHaveLength(2);
    expect(argv[0][0]).toBe("drive:search");
    expect(argv[0][1]).toBe(DRIVE_PLAN_QUERY);
    expect(argv[0].slice(-2)).toEqual(["--consumer", "runway-sheet-sync"]);
    expect(JSON.parse(argv[1][2])).toMatchObject({ pageToken: "p2" });
  });

  it("asks Drive for spreadsheets only, not trashed, with a plan or schedule name", () => {
    expect(DRIVE_PLAN_QUERY).toContain("mimeType = 'application/vnd.google-apps.spreadsheet'");
    expect(DRIVE_PLAN_QUERY).toContain("trashed = false");
    expect(DRIVE_PLAN_QUERY).toContain("name contains 'Project-Plan-v'");
    expect(DRIVE_PLAN_QUERY).toContain("name contains 'Schedule v'");
  });

  it("lists a Schedule v3 plan, so it lands in the coverage denominator", async () => {
    const schedule = { id: "S", name: "SND-2604-02 | Pre-Purchase Phase 2 | Schedule v3", modifiedTime: "2026-10-24T00:00:00.000Z" };
    const other = { id: "O", name: "SND-2604-02 | Pre-Purchase Phase 2 | Budget", modifiedTime: "2026-10-24T00:00:00.000Z" };
    const listing = await listDrivePlanSheets({ cliPath: queryStub([f("A"), schedule, other]) });
    expect(listing.map((x) => x.id)).toEqual(["A", "S"]);
    const result = buildCoverage({ listing, registry: [], exclusions: [], readReport: () => ({ kind: "none" }) });
    expect(result.driveTotal).toBe(2);
    expect(result.rows.find((r) => r.sheetId === "S")?.label).toBe("MISSING");
  });

  it("keeps a file returned on two pages once", async () => {
    const cliPath = stub({
      first: { files: [f("A")], nextPageToken: "p2" },
      p2: { files: [f("A"), f("B")], nextPageToken: null },
    });
    expect((await listDrivePlanSheets({ cliPath })).map((x) => x.id)).toEqual(["A", "B"]);
  });

  it("throws when a later page fails, never returning the short list", async () => {
    const cliPath = stub({ first: { files: [f("A")], nextPageToken: "p2" }, p2: "fail" });
    await expect(listDrivePlanSheets({ cliPath })).rejects.toThrow(/exited with code 1/);
  });

  it("throws on an empty listing", async () => {
    const cliPath = stub({ first: { files: [], nextPageToken: null } });
    await expect(listDrivePlanSheets({ cliPath })).rejects.toThrow(/no plan sheets/);
  });

  it("throws on output without a files array", async () => {
    const cliPath = stub({ first: { items: [f("A")] } });
    await expect(listDrivePlanSheets({ cliPath })).rejects.toThrow(/files/);
  });

  it("throws when the page cap is hit with a next page still owed", async () => {
    const cliPath = stub({
      first: { files: [f("A")], nextPageToken: "p2" },
      p2: { files: [f("B")], nextPageToken: "p3" },
    });
    await expect(listDrivePlanSheets({ cliPath, maxPages: 2 })).rejects.toThrow(/page/);
  });
});
