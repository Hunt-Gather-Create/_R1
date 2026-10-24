/**
 * Each named list in the sync has one owner. A second file that types the
 * list out again fails here, so the copies cannot drift apart.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { WEEK_ITEM_CATEGORIES } from "../../src/lib/runway/week-item-categories";
import { WEEK_ITEM_STATUSES } from "../../src/lib/runway/week-item-statuses";
import { CLIENT_SLUGS } from "./client-slugs";
import { SYNC_FIELDS } from "./sync-fields";

const HERE = __dirname;

/** Every source file of the sync tool, tests and test fixtures left out. */
function sourceFiles(): { path: string; text: string }[] {
  const dirs = [HERE, join(HERE, "parity")];
  const files = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && !n.endsWith(".test-fixtures.ts"))
      .map((n) => join(dir, n))
  );
  files.push(join(HERE, "..", "runway-sheet-sync.ts"), join(HERE, "..", "runway-sheet-coverage.ts"));
  return files.map((path) => ({ path: path.slice(join(HERE, "..").length + 1), text: readFileSync(path, "utf8") }));
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Three or more members of a list written next to each other, as an array or a union. */
function listLiteral(members: readonly string[]): RegExp {
  const one = `"(?:${members.map(escape).join("|")})"`;
  return new RegExp(`${one}(?:[\\s,|]+${one}){2,}`);
}

interface NamedList {
  name: string;
  /** The file that may define it, relative to scripts/, or null when src/lib/runway owns it. */
  owner: string | null;
  defines: RegExp;
}

const LISTS: NamedList[] = [
  { name: "week item status enum", owner: null, defines: listLiteral(WEEK_ITEM_STATUSES) },
  { name: "week item category enum", owner: null, defines: listLiteral(WEEK_ITEM_CATEGORIES) },
  { name: "FieldDelta field names", owner: "runway-sheet-sync/sync-fields.ts", defines: listLiteral(SYNC_FIELDS) },
  {
    name: "client slugs",
    owner: "runway-sheet-sync/client-slugs.ts",
    defines: new RegExp(`["'](?:${Object.values(CLIENT_SLUGS).map(escape).join("|")})["']`),
  },
  { name: "sheet column letters", owner: "runway-sheet-sync/columns.ts", defines: /\bB:\s*1\s*,\s*C:\s*2\b/ },
  { name: "live sheet range", owner: "runway-sheet-sync/columns.ts", defines: /!A1:N\b/ },
];

describe("one owner per named list", () => {
  const files = sourceFiles();

  it("reads the whole tool, so a clean result means something", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.map((f) => f.path)).toContain("runway-sheet-sync/diff.ts");
  });

  for (const list of LISTS) {
    it(`${list.name} is defined only in ${list.owner ?? "src/lib/runway"}`, () => {
      const definers = files.filter((f) => list.defines.test(f.text)).map((f) => f.path);
      expect(definers).toEqual(list.owner ? [list.owner] : []);
    });
  }

  it("each detector catches a copy, so a pass is not a blind spot", () => {
    const copies: Record<string, string> = {
      "week item status enum": `type S = "scheduled" | "in-progress" | "blocked";`,
      "week item category enum": `const C = ["delivery", "review", "kickoff"] as const;`,
      "FieldDelta field names": `field: "status" | "startDate" | "endDate";`,
      "client slugs": `clientSlug: "lppc",`,
      "sheet column letters": `const COL = { B: 1, C: 2, E: 4 } as const;`,
      "live sheet range": `const R = "Task Tracker & Gantt Chart!A1:N";`,
    };
    for (const list of LISTS) expect(list.defines.test(copies[list.name]), list.name).toBe(true);
  });
});
