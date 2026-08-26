/**
 * Crit-7 harness gate: proves the test suite can never write prod by
 * misconfiguration. Scans every *.test.ts under scripts/runway-sheet-sync/
 * and src/lib/runway/ (except this file) and asserts:
 *   - no file contains the --target prod CLI phrase
 *   - no file contains a process.env.<ALLOW> assignment
 *
 * Forbidden patterns are built by concatenation so this file itself does
 * not contain them as literals and cannot trip on its own grep.
 *
 * Passing the ALLOW name as a computed key inside a mock env object like
 * `{ [ALLOW]: "1" }` is permitted — only process.env.<ALLOW> writes are
 * forbidden.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Build forbidden patterns by concatenation — this file must not contain
// them as plain string literals.
const FLAG = "--target " + "prod";
const ALLOW = "RUNWAY_ALLOW_" + "PROD_WRITE";
const PROC_ALLOW = "process.env." + ALLOW;

function collectTestFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

const ROOT = path.resolve(__dirname, "../..");
const SHEET_SYNC_DIR = path.join(ROOT, "scripts/runway-sheet-sync");
const RUNWAY_LIB_DIR = path.join(ROOT, "src/lib/runway");
const THIS_FILE = path.basename(__filename);

const allFiles = [
  ...collectTestFiles(SHEET_SYNC_DIR),
  ...collectTestFiles(RUNWAY_LIB_DIR),
].filter((f) => path.basename(f) !== THIS_FILE);

describe("crit-7 harness: no prod-write in test suite", () => {
  it("no test file contains the --target prod CLI phrase", () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes(FLAG)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `Files containing "${FLAG}": ${offenders.join(", ")}`
    ).toHaveLength(0);
  });

  it("no test file assigns process.env.RUNWAY_ALLOW_PROD_WRITE", () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes(PROC_ALLOW)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `Files containing "${PROC_ALLOW}": ${offenders.join(", ")}`
    ).toHaveLength(0);
  });
});
