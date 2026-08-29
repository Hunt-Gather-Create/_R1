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
 * Round 3: a text-matching call-site check (`\btimingSafeTokenMatch\s*\(`)
 * is itself beatable by the exact regression this ticket exists to catch -
 * comment out the real call and drop a padded plain-equality compare next
 * to it, and the regex still "counts" the call because it matches text, not
 * code. The call-site check is now an AST walk via the TypeScript compiler
 * API (parsed with the strict TS parser, so a commented-out or
 * string-literal call is not a node in the tree and does not count),
 * scoped to the two KNOWN_AUTH_ROUTES files only. It is not extended to the
 * broad sweep below on purpose - see the scope-limits note.
 *
 * The v2 shape-match sweep is kept below as a broad secondary net over the
 * wider `src/app/api` tree (routes with no known auth helper yet, future
 * files, etc). It is not the primary control.
 *
 * Scope limits:
 * - The shape-match sweep is a heuristic that a sufficiently distant or
 *   restructured compare defeats - see the padding bypass this guard was
 *   rewritten to survive.
 * - The call-site assertion proves the call EXISTS somewhere in the file's
 *   syntax tree. It does not prove the call GATES the request - a real call
 *   to timingSafeTokenMatch sitting in dead code, an unreachable branch, or
 *   with its result discarded would satisfy this check. Proving the call is
 *   reachable from the exported route handler is call-graph analysis, which
 *   this guard does not attempt.
 * - A compare that is isolated far from any token/apiKey identifier, in a
 *   file that also still contains a real, reachable timingSafeTokenMatch
 *   call elsewhere, is caught by nothing here: the call-site check only
 *   asserts a call exists, and the shape sweep's window (200) would not
 *   reach a sufficiently distant compare.
 * - It does not (yet) cover a future third auth route, which would need to
 *   be added to KNOWN_AUTH_ROUTES by hand.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

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
  path.join(AUTH_ROOT, "runway/gantt-embed/route.ts"),
];

// Counts real CALL EXPRESSIONS to timingSafeTokenMatch by parsing the file
// with the TypeScript compiler API, not by matching text. A regex on the
// source text matches a commented-out call
// (`// timingSafeTokenMatch(token, apiKey);`) or one sitting in a string
// literal exactly as readily as a live one - a bypass that comments out the
// real call and drops in a plain-equality compare next to it stayed green
// under the old regex version of this check with a call "count" of 1. A
// comment or a string literal is not a node in the parsed AST, so walking
// the tree for actual CallExpression nodes closes that gap by construction.
// Scoped to the two KNOWN_AUTH_ROUTES files only - this does not extend to
// the broad sweep below, which stays text-based on purpose (see the
// scope-limits note at the top of this file for why).
function countTimingSafeCallExpressions(source: string, fileName: string): number {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "timingSafeTokenMatch"
    ) {
      count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
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
  it.each(KNOWN_AUTH_ROUTES)("%s contains at least one real timingSafeTokenMatch call expression", (file) => {
    const content = fs.readFileSync(file, "utf-8");
    expect(countTimingSafeCallExpressions(content, file)).toBeGreaterThanOrEqual(1);
  });

  it("does not count a commented-out call as a real call expression", () => {
    const commentedOut = `
      // timingSafeTokenMatch(token, apiKey); disabled for canary rollout
      function validateAuth(token, apiKey) {
        return token === apiKey;
      }
    `;
    expect(countTimingSafeCallExpressions(commentedOut, "fixture.ts")).toBe(0);
  });

  it("does not count a call inside a string literal as a real call expression", () => {
    const inString = `
      const note = "call timingSafeTokenMatch(token, apiKey) here later";
      function validateAuth(token, apiKey) {
        return token === apiKey;
      }
    `;
    expect(countTimingSafeCallExpressions(inString, "fixture.ts")).toBe(0);
  });

  it("still counts the call after a legitimate reformat (multi-line args, added parens)", () => {
    const reformatted = `
      function validateAuth(token, apiKey) {
        return (
          timingSafeTokenMatch(
            token,
            apiKey,
          )
        );
      }
    `;
    expect(countTimingSafeCallExpressions(reformatted, "fixture.ts")).toBe(1);
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
