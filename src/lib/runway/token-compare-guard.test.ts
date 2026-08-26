/**
 * Textual regression guard for #106: #129 replaced `token === apiKey` with a
 * constant-time compare (timingSafeTokenMatch). Overwatch mutated that merged
 * branch and put the plain-equality line back, and 9 of 9 functional tests
 * stayed green - the two versions behave identically except for timing,
 * which no functional assertion can observe. This check is textual on
 * purpose: it scans Runway's API route sources for the shape of a plain
 * equality compare near a token/apiKey identifier and fails if any appear.
 *
 * The first version of this guard matched four fixed substrings and was
 * itself bypassed: renaming `token`/`apiKey` to `supplied`/`expected` right
 * before the compare, and splitting `==` onto its own line, left it green
 * while the vulnerability was live (see the positive-control tests below).
 * This version matches the SHAPE instead: it normalizes whitespace and
 * looks for a `==`/`===` operator with `token` and `apiKey` both present in
 * a window of surrounding source, which still catches the rename because
 * the alias assignments sit right next to the compare they feed.
 *
 * Scope limits: this stops a class of textual regression in Runway's API
 * routes. It does not make the compare provably constant-time (only a real
 * timing-safe primitive does that, see timing-safe-token.ts) and it is not
 * an AST check - a compare far enough from its identifiers, or routed
 * through a further level of indirection, can still slip past a regex.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const AUTH_ROOT = path.join(ROOT, "src/app/api");
const THIS_FILE = path.resolve(__filename);

// How far (in characters, on whitespace-normalized source) an equality
// operator may sit from a token/apiKey mention and still count as the same
// compare. Wide enough to span a couple of short alias assignments right
// before a `return`, narrow enough not to span unrelated code in the file.
const WINDOW = 200;

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

/**
 * True if `source` contains a `==`/`===` operator with both a `token` and
 * an `apiKey` mention (bare identifier, or `process.env.*`) within WINDOW
 * characters of it on whitespace-normalized source. Shape-based on purpose:
 * it does not require the identifiers to sit directly next to the operator,
 * so it still catches a compare fed by freshly-aliased variables.
 */
function hasTokenEqualityShape(source: string): boolean {
  const normalized = source.replace(/\s+/g, " ");
  const opPattern = /(?<![=!])={2,3}(?!=)/g;
  let match: RegExpExecArray | null;
  while ((match = opPattern.exec(normalized)) !== null) {
    const start = Math.max(0, match.index - WINDOW);
    const end = Math.min(normalized.length, match.index + match[0].length + WINDOW);
    const windowText = normalized.slice(start, end);
    const hasToken = /\btoken\b/.test(windowText);
    const hasApiKey = /\bapiKey\b/.test(windowText) || /process\.env\b/.test(windowText);
    if (hasToken && hasApiKey) {
      return true;
    }
  }
  return false;
}

const allFiles = collectSourceFiles(AUTH_ROOT);

describe("token-compare guard: no plain-equality token compare in Runway API routes", () => {
  it("scans at least 20 API route source files", () => {
    expect(allFiles.length).toBeGreaterThanOrEqual(20);
  });

  it("no API route source contains an equality-shaped token/apiKey compare", () => {
    const offenders: string[] = [];
    for (const file of allFiles) {
      const content = fs.readFileSync(file, "utf-8");
      if (hasTokenEqualityShape(content)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `Equality-shaped token/apiKey compare found:\n${offenders.join("\n")}`,
    ).toHaveLength(0);
  });

  describe("positive controls: the detector actually fires on known bypasses", () => {
    it("flags the original literal compare (token === apiKey)", () => {
      const bypass = `
        function validateAuth(token, apiKey) {
          return token === apiKey;
        }
      `;
      expect(hasTokenEqualityShape(bypass)).toBe(true);
    });

    it("flags the scout's renamed-alias bypass that beat the first version of this guard", () => {
      // Exact shape QA reported live at 1029edd9a436dd9f636b26f033ce84a3916b3ead:
      // rename token/apiKey to supplied/expected immediately before the
      // compare, and split `==` onto its own line. The substring-matching
      // guard stayed green against this. This one must not.
      const bypass = `
        function validateAuth(request) {
          const apiKey = process.env.RUNWAY_MCP_API_KEY;
          const token = authHeader.slice(7);
          const supplied = token;
          const expected = apiKey;
          return supplied
            ==
            expected;
        }
      `;
      expect(hasTokenEqualityShape(bypass)).toBe(true);
    });

    it("does not flag the real, constant-time compare", () => {
      const safe = fs.readFileSync(
        path.join(AUTH_ROOT, "mcp/runway/route.ts"),
        "utf-8",
      );
      expect(hasTokenEqualityShape(safe)).toBe(false);
    });
  });
});
