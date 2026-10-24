/**
 * Guard: every Runway server action calls requireRunwayGate first, so a new
 * action cannot ship ungated. Only the login action is exempt.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { scanServerActionGates } from "./server-action-gate-scan";

const ROOT = path.resolve(__dirname, "../../..");
const SCAN_DIRS = ["src/app/runway", "src/lib/runway"];

// The login action hands out the cookie, so it must run without one.
const ALLOW_UNGATED: Record<string, ReadonlySet<string>> = {
  "src/app/runway/auth/actions.ts": new Set(["verifyAndSetRunwayAuth"]),
};

// Known actions today. The scan must find each one gated, which proves it
// is reading the real files and not passing because it found nothing.
const KNOWN_GATED = [
  "src/app/runway/actions.ts:toggleInFlightAction",
  "src/app/runway/actions.ts:toggleNeedsUpdateAction",
  "src/app/runway/actions.ts:setWeekItemStatusAction",
  "src/app/runway/actions.ts:updateWeekItemFieldsAction",
  "src/app/runway/actions.ts:listProjectsForWeekItemAction",
  "src/lib/runway/view-preferences.ts:getViewPreferences",
  "src/lib/runway/view-preferences.ts:setViewPreferences",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__fixtures__") {
        out.push(...sourceFiles(full));
      }
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scanRepo() {
  const gated: string[] = [];
  const ungated: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const source = fs.readFileSync(file, "utf8");
      if (!source.includes("use server")) continue;
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      const scan = scanServerActionGates(rel, source, ALLOW_UNGATED[rel]);
      gated.push(...scan.gated.map((n) => `${rel}:${n}`));
      ungated.push(...scan.ungated.map((n) => `${rel}:${n}`));
    }
  }
  return { gated, ungated };
}

describe("Runway server action gate guard", () => {
  it("finds no server action under src/app/runway or src/lib/runway without the gate", () => {
    expect(scanRepo().ungated).toEqual([]);
  });

  it("finds every known action and sees it gated", () => {
    expect(scanRepo().gated).toEqual(expect.arrayContaining(KNOWN_GATED));
  });
});

describe("scanServerActionGates positive controls", () => {
  const gate = "await requireRunwayGate();";

  it("flags an exported action with no gate call", () => {
    const src = `"use server";\nexport async function a() { return 1; }`;
    expect(scanServerActionGates("x.ts", src).ungated).toEqual(["a"]);
  });

  it("flags an action whose gate call is not the first statement", () => {
    const src = `"use server";\nexport async function a() { const x = 1; ${gate} return x; }`;
    expect(scanServerActionGates("x.ts", src).ungated).toEqual(["a"]);
  });

  it("flags a commented-out gate call", () => {
    const src = `"use server";\nexport async function a() {\n// ${gate}\nreturn 1; }`;
    expect(scanServerActionGates("x.ts", src).ungated).toEqual(["a"]);
  });

  it("flags an exported arrow action and an export list it cannot check", () => {
    const src = `"use server";\nexport const b = async () => 1;\nasync function c() {}\nexport { c };`;
    const { ungated } = scanServerActionGates("x.ts", src);
    expect(ungated).toContain("b");
    expect(ungated.some((n) => n.startsWith("export-list@"))).toBe(true);
  });

  it("flags an inline server action in a file without the file directive", () => {
    const src = `export function Form() { async function save() { "use server"; return 1; } return save; }`;
    expect(scanServerActionGates("x.tsx", src).ungated).toEqual(["save"]);
  });

  it("passes gated actions and ignores type exports and the allow list", () => {
    const src = `"use server";\nexport type T = { a: 1 };\nexport interface I { b: 2 }\nexport async function a() { ${gate} return 1; }\nexport async function login() { return 2; }`;
    const scan = scanServerActionGates("x.ts", src, new Set(["login"]));
    expect(scan).toEqual({ gated: ["a"], ungated: [] });
  });

  it("ignores a file that only mentions use server in a comment", () => {
    const src = `/** carries the "use server" directive elsewhere */\nexport function f() { return 1; }`;
    expect(scanServerActionGates("x.ts", src)).toEqual({ gated: [], ungated: [] });
  });
});
