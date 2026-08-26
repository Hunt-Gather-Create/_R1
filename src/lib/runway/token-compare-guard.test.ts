/**
 * Regression guard for #106: #129 replaced `token === apiKey` with a
 * constant-time compare (timingSafeTokenMatch). Overwatch mutated that merged
 * branch and put the plain-equality line back, and 9 of 9 functional tests
 * stayed green - the two versions behave identically except for timing,
 * which no functional assertion can observe.
 *
 * Two rounds of textual bug-hunting both got beaten: a fixed-substring match
 * fell to a rename (token/apiKey -> supplied/expected), and a windowed
 * shape-match (v2) fell to padding the compare 800+ characters away from the
 * nearest token/apiKey mention. Any fixed window loses to enough padding,
 * and a window wide enough to resist padding swallows the whole file and
 * false-positives. That is structural, not a tuning problem.
 *
 * So the primary control here is inverted: instead of hunting for the
 * infinite set of ways to reintroduce a plain-equality compare, it asserts
 * the fix is present. The #129/#106 regression is defined by one fact: the
 * known Runway auth routes stop calling timingSafeTokenMatch. That fact
 * can't be padded, renamed, or whitespaced away, because the attack has to
 * delete the call to introduce the compare. This checks the call site, not
 * the import - a bypass can leave the import line untouched.
 *
 * The v2 shape-match sweep is kept below as a broad secondary net over the
 * wider `src/app/api` tree (routes with no known auth helper yet, future
 * files, etc). It is not the primary control anymore.
 *
 * Scope limits: the shape-match sweep is a heuristic that a sufficiently
 * distant or restructured compare defeats - see the padding bypass this
 * guard was rewritten to survive. The call-site assertion is what actually
 * holds the line for the two routes it covers; it does not (yet) cover a
 * future third auth route, which would need to be added to
 * KNOWN_AUTH_ROUTES by hand.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const AUTH_ROOT = path.join(ROOT, "src/app/api");
const THIS_FILE = path.resolve(__filename);

// How far (in characters, on whitespace-normalized source) an equality
// operator may sit from a token/apiKey mention and still count as the same
// compare, for the broad secondary sweep below. Left at 200 deliberately -
// see the scope-limits note above for why no value of this constant is a
// real fix.
const WINDOW = 200;

// The Runway auth routes known to gate on RUNWAY_MCP_API_KEY via
// timingSafeTokenMatch. This is the primary control's coverage list.
const KNOWN_AUTH_ROUTES = [
  path.join(AUTH_ROOT, "mcp/runway/route.ts"),
  path.join(AUTH_ROOT, "runway/gantt-generate/route.ts"),
];

// Counts CALL sites, not the import line: `import { timingSafeTokenMatch }`
// matches an import-only bypass that deleted every call, so this requires
// the open-paren that only a call site has.
function countTimingSafeCalls(source: string): number {
  const matches = source.match(/\btimingSafeTokenMatch\s*\(/g);
  return matches ? matches.length : 0;
}

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

describe("token-compare guard: known auth routes must call timingSafeTokenMatch", () => {
  it.each(KNOWN_AUTH_ROUTES)("%s contains at least one timingSafeTokenMatch call", (file) => {
    const content = fs.readFileSync(file, "utf-8");
    expect(countTimingSafeCalls(content)).toBeGreaterThanOrEqual(1);
  });
});

describe("token-compare guard: no plain-equality token compare in Runway API routes (broad net)", () => {
  it("scans at least 32 API route source files", () => {
    expect(allFiles.length).toBeGreaterThanOrEqual(32);
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

    it("does not flag the real, constant-time compare shape", () => {
      // A fixture string, not a read of a live route file: the live route
      // is covered by the sweep above, and a control that reads the same
      // file it is meant to control moves in lockstep with it (see #106
      // bounce 2, lines 130-138 of the prior version) - it is not a control.
      const safe = `
        import { timingSafeTokenMatch } from "@/lib/runway/timing-safe-token";

        function validateAuth(request) {
          const apiKey = process.env.RUNWAY_MCP_API_KEY;
          const authHeader = request.headers.get("authorization");
          const token = authHeader.slice(7);
          return timingSafeTokenMatch(token, apiKey);
        }
      `;
      expect(hasTokenEqualityShape(safe)).toBe(false);
    });
  });
});
