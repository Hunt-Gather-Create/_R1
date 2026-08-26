/**
 * Textual regression guard for #106: #129 replaced `token === apiKey` with a
 * constant-time compare (timingSafeTokenMatch). Overwatch mutated that merged
 * branch and put the plain-equality line back, and 9 of 9 functional tests
 * stayed green — the two versions behave identically except for timing,
 * which no functional assertion can observe. This check is textual on
 * purpose: it scans the Runway auth route sources for the forbidden
 * plain-equality shapes and fails if any appear.
 *
 * Forbidden patterns are built by concatenation so this file does not
 * contain them as literals and cannot trip on its own scan.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const EQ = "=" + "==";
const FORBIDDEN_PATTERNS = [
  "token " + EQ,
  EQ + " apiKey",
  "apiKey " + EQ,
  EQ + " process.env",
];

const ROOT = path.resolve(__dirname, "../../..");
const AUTH_DIRS = [
  path.join(ROOT, "src/app/api/runway/gantt-generate"),
  path.join(ROOT, "src/app/api/mcp/runway"),
];
const THIS_FILE = path.resolve(__filename);

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (
      entry.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx")) &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".test.tsx") &&
      path.resolve(full) !== THIS_FILE
    ) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = [
  ...collectSourceFiles(AUTH_DIRS[0]),
  ...collectSourceFiles(AUTH_DIRS[1]),
];

describe("token-compare guard: no plain-equality token compare in Runway auth paths", () => {
  it("scans at least the two known auth route files", () => {
    expect(allFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("no auth route source contains a plain-equality token/apiKey/process.env compare", () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf-8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (content.includes(pattern)) {
          offenders.push(`${file} (contains "${pattern}")`);
        }
      }
    }
    expect(
      offenders,
      `Plain-equality token compare found:\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });
});
