import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleApiCliError, resolveGoogleApiCli, runGoogleApiCli } from "./google-api-cli";
import { readSheetViaGoogleApiCli } from "./sheets-client";
import type { SheetFixture } from "./types";

// Each stub stands in for the google-api cli.js. It records its argv next to
// itself so a test can read back exactly what the runner passed.
let dir: string;

function stub(body: string): string {
  const path = join(dir, "cli.cjs");
  writeFileSync(
    path,
    `require("fs").writeFileSync(${JSON.stringify(join(dir, "argv.json"))}, JSON.stringify(process.argv.slice(2)));\n${body}\n`
  );
  return path;
}

function recordedArgv(): string[] {
  return JSON.parse(readFileSync(join(dir, "argv.json"), "utf8")) as string[];
}

const READ_OUT = {
  range: "'Task Tracker & Gantt Chart'!A1:N3",
  majorDimension: "ROWS",
  values: [["", "TASKS", "START"], ["", "Kickoff", "1/5/2026"]],
};
const okStub = () => stub(`process.stdout.write(JSON.stringify(${JSON.stringify(READ_OUT)}, null, 2) + "\\n");`);
const RANGE = "Task Tracker & Gantt Chart!A1:N";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "runway-gapi-stub-"));
});
afterEach(() => {
  delete process.env.RUNWAY_GOOGLE_API_CLI;
  vi.unstubAllEnvs();
});

describe("the env the CLI child sees", () => {
  // macOS adds __CF_USER_TEXT_ENCODING to every process it starts; the parent does not pass it.
  const envStub = () =>
    stub(`const e = { ...process.env }; delete e.__CF_USER_TEXT_ENCODING; process.stdout.write(JSON.stringify(e));`);

  it("carries GOOGLE_API_HOME when set, beside HOME and PATH, and no other variable", async () => {
    vi.stubEnv("GOOGLE_API_HOME", "/tmp/unmerged-google-api-clone");
    vi.stubEnv("RUNWAY_SYNC_DECOY", "must-not-pass");
    const childEnv = (await runGoogleApiCli("whoami", [], { cliPath: envStub() })) as Record<string, string>;
    expect(Object.keys(childEnv).sort()).toEqual(["GOOGLE_API_HOME", "HOME", "PATH"]);
    expect(childEnv.GOOGLE_API_HOME).toBe("/tmp/unmerged-google-api-clone");
  });

  it("carries only HOME and PATH when GOOGLE_API_HOME is not set", async () => {
    vi.stubEnv("GOOGLE_API_HOME", undefined);
    const childEnv = (await runGoogleApiCli("whoami", [], { cliPath: envStub() })) as Record<string, string>;
    expect(Object.keys(childEnv).sort()).toEqual(["HOME", "PATH"]);
  });
});

describe("readSheetViaGoogleApiCli, live read through the google-api one door", () => {
  it("returns the same SheetFixture shape as the fixture-file path, from the stub's JSON", async () => {
    const fx = await readSheetViaGoogleApiCli("sheet-123", RANGE, { cliPath: okStub() });
    const fixtureFileShape: SheetFixture = {
      sheetId: "sheet-123",
      tab: "Task Tracker & Gantt Chart",
      range: RANGE,
      exportedAt: "2026-01-01T00:00:00Z",
      values: READ_OUT.values,
    };
    expect(Object.keys(fx).sort()).toEqual(Object.keys(fixtureFileShape).sort());
    expect(fx).toEqual({ ...fixtureFileShape, exportedAt: expect.any(String) });
  });

  it("passes sheets:read and --consumer runway-sheet-sync to the CLI", async () => {
    await readSheetViaGoogleApiCli("sheet-123", RANGE, { cliPath: okStub() });
    expect(recordedArgv()).toEqual(["sheets:read", "sheet-123", RANGE, "--consumer", "runway-sheet-sync"]);
  });

  it("uses RUNWAY_GOOGLE_API_CLI when no explicit path is given", async () => {
    process.env.RUNWAY_GOOGLE_API_CLI = okStub();
    const fx = await readSheetViaGoogleApiCli("sheet-123", RANGE);
    expect(fx.values).toEqual(READ_OUT.values);
    expect(resolveGoogleApiCli({})).toMatch(/\.claude\/skills\/google-api\/cli\.js$/);
  });
});

describe("a failed CLI stops the run with one plain message, never an empty sheet", () => {
  it("non-zero exit", async () => {
    const cliPath = stub(`process.stderr.write("[google-api] not a registered consumer\\n"); process.exit(3);`);
    const run = readSheetViaGoogleApiCli("s", RANGE, { cliPath });
    await expect(run).rejects.toThrow(GoogleApiCliError);
    await expect(run).rejects.toThrow(
      "google-api CLI sheets:read exited with code 3: [google-api] not a registered consumer"
    );
  });

  it("timeout", async () => {
    const cliPath = stub(`setTimeout(() => process.stdout.write("{}"), 20000);`);
    await expect(readSheetViaGoogleApiCli("s", RANGE, { cliPath, timeoutMs: 300 })).rejects.toThrow(
      "google-api CLI sheets:read timed out after 300ms"
    );
  });

  it("non-JSON output", async () => {
    const cliPath = stub(`process.stdout.write("Opening browser for consent...\\n");`);
    await expect(readSheetViaGoogleApiCli("s", RANGE, { cliPath })).rejects.toThrow(
      "google-api CLI sheets:read printed output that is not JSON"
    );
  });

  it("JSON with no values array", async () => {
    const cliPath = stub(`process.stdout.write(JSON.stringify({ range: "x" }));`);
    await expect(readSheetViaGoogleApiCli("s", RANGE, { cliPath })).rejects.toThrow(
      "google-api CLI sheets:read printed JSON with no values array"
    );
  });

  it("a CLI path that does not exist", async () => {
    await expect(
      readSheetViaGoogleApiCli("s", RANGE, { cliPath: join(dir, "missing-cli.js") })
    ).rejects.toThrow(GoogleApiCliError);
  });
});
