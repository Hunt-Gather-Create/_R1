/**
 * Lint guard: every production call site of an operations-layer write helper
 * must include a `source:` argument. NULL `source` rows must not exist in the
 * `updates` audit table after Wave 0d (pre-plan v7 §A5).
 *
 * Approach: enumerate the production source files git actually tracks under
 * `src/` and `scripts/`, excluding test, mock, and source-files-of-the-helpers
 * themselves, pull every helper call by regex, and assert each call's
 * argument object contains a `source:` key.
 *
 * File list comes from `git ls-files`, not a filesystem walk. A file git
 * does not track, such as a one-shot migration script matched by a
 * `.gitignore` glob, is not a production call site by definition, so it
 * must never reach the sweep. Walking the filesystem instead would pick up
 * whatever untracked litter happens to sit in a working tree, which is a
 * property of that tree, not of the code being guarded.
 *
 * Test files are excluded — mocks don't write real audit rows. Helper source
 * files (`operations-add.ts` etc.) are excluded too — those define the
 * helpers, they don't call them as audit writers. `setProjectParent` in
 * `operations-writes-project.ts` is also a helper-internal forwarding call
 * (it routes through `updateProjectField`); the source flows in from the
 * caller, so the internal call site doesn't need its own `source:`.
 *
 * Helpers covered:
 *   - addProject
 *   - createWeekItem
 *   - createTeamMember
 *   - updateProjectField
 *   - updateProjectStatus
 *   - updateWeekItemField
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { execFileSync } from "node:child_process";
import { join, extname } from "path";

const HELPERS = [
  "addProject",
  "createWeekItem",
  "createTeamMember",
  "updateProjectField",
  "updateProjectStatus",
  "updateWeekItemField",
] as const;

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "scripts"];

/** File globs to exclude from the sweep. */
function shouldSkipFile(absPath: string): boolean {
  // Exclude test files + setup helpers + mocks.
  if (
    absPath.endsWith(".test.ts") ||
    absPath.endsWith(".test.tsx") ||
    absPath.includes("/__mocks__/") ||
    absPath.endsWith("queries-test-helpers.ts") ||
    absPath.endsWith("test-helpers.ts")
  ) {
    return true;
  }
  // Exclude the helper source files themselves — they define `addProject`
  // etc., not call them as audit writers. Also excludes `operations.ts`
  // (the barrel re-export). `operations-writes-project.ts` defines
  // `setProjectParent`, which forwards through `updateProjectField` — the
  // forwarding call is internal plumbing, not a fresh audit-writing entry
  // point, so we skip the file.
  const HELPER_SOURCE_FILES = [
    "src/lib/runway/operations-add.ts",
    "src/lib/runway/operations-writes.ts",
    "src/lib/runway/operations-writes-project.ts",
    "src/lib/runway/operations-writes-week.ts",
    "src/lib/runway/operations-writes-team.ts",
    "src/lib/runway/operations-utils.ts",
    "src/lib/runway/operations.ts",
  ];
  for (const helper of HELPER_SOURCE_FILES) {
    if (absPath.endsWith(helper)) return true;
  }
  return false;
}

/**
 * Collect production .ts/.tsx files under a directory from the git index,
 * not the filesystem. A file git does not track is not a production call
 * site by definition, which is what keeps gitignored one-shot scripts,
 * such as scripts/runway-migrations/*-2026-06-*.ts, out of the sweep
 * without a second, hand-maintained exclusion list that has to be kept in
 * sync with .gitignore.
 */
// A caller that runs this suite from inside a git hook, such as pre push,
// has GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, or GIT_COMMON_DIR already
// set in its process environment, since that is how git invokes hooks.
// Left in place, git honors those inherited variables over the cwd this
// call passes, so ls-files would silently read a different repository's
// index than ROOT, and this sweep would measure the wrong file set
// without any error to say so. Stripping them makes cwd the only thing
// that decides which index this call reads.
const GIT_ENV_WITHOUT_INHERITED_REPO = { ...process.env };
delete GIT_ENV_WITHOUT_INHERITED_REPO.GIT_DIR;
delete GIT_ENV_WITHOUT_INHERITED_REPO.GIT_WORK_TREE;
delete GIT_ENV_WITHOUT_INHERITED_REPO.GIT_INDEX_FILE;
delete GIT_ENV_WITHOUT_INHERITED_REPO.GIT_COMMON_DIR;

function gitTrackedFiles(relDir: string): string[] {
  const output = execFileSync("git", ["ls-files", "--", relDir], {
    cwd: ROOT,
    encoding: "utf8",
    env: GIT_ENV_WITHOUT_INHERITED_REPO,
  });
  const out: string[] = [];
  for (const line of output.split("\n")) {
    const rel = line.trim();
    if (!rel) continue;
    const ext = extname(rel);
    if (ext !== ".ts" && ext !== ".tsx") continue;
    const abs = join(ROOT, rel);
    if (shouldSkipFile(abs)) continue;
    out.push(abs);
  }
  return out;
}

interface CallSite {
  file: string;
  helper: string;
  startLine: number;
  /** Full call argument body — used for source-tag detection. */
  body: string;
  /** Truncated excerpt — used for human-readable error reporting. */
  bodyExcerpt: string;
}

/**
 * Strip line comments, block comments, and string literals from TypeScript
 * source — replacing each with spaces of the same length so character offsets
 * stay aligned. The regex then can't match identifiers inside comments or
 * error message strings.
 */
function stripCommentsAndStrings(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    // Line comment
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") {
        out.push(src[i] === "\n" ? "\n" : " ");
        i++;
      }
      continue;
    }
    // Block comment
    if (ch === "/" && next === "*") {
      out.push("  ");
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out.push(src[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < src.length) {
        out.push("  ");
        i += 2;
      }
      continue;
    }
    // String literal (single, double, backtick).
    const QUOTES = ["\u0022", "\u0027", "\u0060"]; // " ' `
    if (QUOTES.includes(ch)) {
      const quote = ch;
      out.push(quote);
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          // Escape sequence — keep two chars as spaces.
          out.push(src[i] === "\n" ? "\n" : " ");
          out.push(src[i + 1] === "\n" ? "\n" : " ");
          i += 2;
          continue;
        }
        // Template-literal ${...} interpolation — preserve so call sites
        // inside template strings still match.
        if (quote === "\u0060" && src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          out.push("$");
          out.push("{");
          i += 2;
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth === 0) break;
            out.push(src[i]);
            i++;
          }
          if (i < src.length) {
            out.push("}");
            i++;
          }
          continue;
        }
        out.push(src[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < src.length) {
        out.push(quote);
        i++;
      }
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

/**
 * Locate every helper call in `src` text. We match `<helper>(` then balance
 * parens (in the original src so the returned body excerpt is human-readable)
 * to capture the argument body. Single-arg-object calls show up as
 * `helper({ ... })`; we want to verify the inner object has a `source:` key.
 *
 * Calls passed by reference (`const fn = addProject; fn(args)` or dispatch
 * tables like `addProject(args as ...)`) skip the `source:` check because
 * they pass a pre-built object — the source key must be present in the
 * upstream construction. The MCP `BATCH_DISPATCH` table is one such case;
 * batch op args are constructed by callers of `batch_apply`, which is itself
 * an MCP tool path, so the upstream caller is responsible.
 */
function findHelperCalls(file: string, src: string): CallSite[] {
  const calls: CallSite[] = [];
  // Run regex over a comment- and string-stripped copy so identifiers in
  // comments and error message strings don't false-positive.
  const stripped = stripCommentsAndStrings(src);
  for (const helper of HELPERS) {
    // Match helper followed by `(` — but skip when preceded by `function `,
    // `export async function`, or `async function` (those are definitions,
    // not call sites).
    const re = new RegExp(`(?<!function\\s)\\b${helper}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      // Determine whether this is a call (paren immediately follows ident)
      // and capture the arg body by paren-matching from the opening `(`.
      // Walk the ORIGINAL src so the body excerpt is readable.
      const openParenIdx = m.index + m[0].length - 1;
      let depth = 1;
      let i = openParenIdx + 1;
      let inString: '"' | "'" | "`" | null = null;
      let escape = false;
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (escape) {
          escape = false;
        } else if (inString) {
          if (ch === "\\") escape = true;
          else if (ch === inString) inString = null;
        } else if (ch === '"' || ch === "'" || ch === "`") {
          inString = ch;
        } else if (ch === "(") {
          depth++;
        } else if (ch === ")") {
          depth--;
        }
        i++;
      }
      const body = src.slice(openParenIdx + 1, i - 1);
      // Compute line number of the call's helper identifier.
      const startLine = src.slice(0, m.index).split("\n").length;
      calls.push({
        file,
        helper,
        startLine,
        body,
        bodyExcerpt: body.length > 240 ? body.slice(0, 240) + "..." : body,
      });
    }
  }
  return calls;
}

/**
 * A call satisfies the source-tag invariant when:
 *  - its arg body contains a `source:` property (string-keyed or shorthand),
 *    OR
 *  - it forwards a pre-built params object (single-identifier arg like
 *    `helper(params)` or `helper(args as ...)`) — those are upstream's
 *    responsibility to tag, not the forwarding site's.
 */
function isCallTagged(body: string): boolean {
  const trimmed = body.trim();

  // Single-identifier or `<ident> as <type>` forwarding: not a literal arg
  // object, source tag must come from the caller. Match patterns like
  // `params`, `args as Foo`, `args as unknown as Bar`.
  if (/^[a-zA-Z_$][\w$]*(\s+as\s+[\w\s<>,.()'"|&[\]]+)?$/.test(trimmed)) {
    return true;
  }

  // Spread-only: `{...params}` with no extra fields — caller's responsibility.
  if (/^\{\s*\.\.\.[a-zA-Z_$][\w$]*\s*\}$/.test(trimmed)) {
    return true;
  }

  // Plain `source:` key inside the literal. Must be at object property
  // position, not nested in a string. Simple word-boundary check is enough
  // for our patterns — call args don't contain literal `source:` substrings
  // outside of the property position.
  if (/(?:^|[\s,{])source\s*:/.test(body)) {
    return true;
  }

  return false;
}

describe("source-coverage lint guard", () => {
  it("can scan production source files (sanity)", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) {
      files.push(...gitTrackedFiles(dir));
    }
    expect(files.length).toBeGreaterThan(0);
  });

  it("every production call site of operations-layer write helpers includes `source:`", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) {
      files.push(...gitTrackedFiles(dir));
    }

    const offenders: Array<{ file: string; helper: string; line: number; body: string }> = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const calls = findHelperCalls(file, src);
      for (const call of calls) {
        if (!isCallTagged(call.body)) {
          offenders.push({
            file: file.replace(ROOT + "/", ""),
            helper: call.helper,
            line: call.startLine,
            body: call.bodyExcerpt,
          });
        }
      }
    }

    expect(
      offenders,
      `Found ${offenders.length} call site(s) of operations-layer write helpers without a 'source:' argument.\n` +
        offenders
          .slice(0, 25)
          .map(
            (o) =>
              `  ${o.file}:${o.line} → ${o.helper}({\n    ${o.body.replace(/\n/g, "\n    ")}\n  })`,
          )
          .join("\n\n"),
    ).toEqual([]);
  });

  it("does not flag call sites inside files git does not track, the planted negative control", () => {
    // .gitignore line 103 ignores scripts/runway-migrations/*-2026-06-*.ts,
    // one-shot data-integrity migrations that already ran and live in Drive
    // by standing rule, never in the repo. Plant a file matching that glob
    // with a bare, untagged call site and assert the sweep does not surface
    // it. This is the control for _R1#111: it must fail red against a
    // filesystem walk, which cannot tell an ignored file from a tracked one,
    // and pass green once the sweep is scoped to the git index.
    const plantedRelPath = "scripts/runway-migrations/999-source-coverage-control-2026-06-01.ts";
    const plantedAbsPath = join(ROOT, plantedRelPath);
    writeFileSync(
      plantedAbsPath,
      `import { createWeekItem } from "@/lib/runway/operations-writes-week";\n\ncreateWeekItem({});\n`,
    );
    try {
      const files: string[] = [];
      for (const dir of SCAN_DIRS) {
        files.push(...gitTrackedFiles(dir));
      }
      const offenders: Array<{ file: string; helper: string }> = [];
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const call of findHelperCalls(file, src)) {
          if (!isCallTagged(call.body)) {
            offenders.push({ file: file.replace(ROOT + "/", ""), helper: call.helper });
          }
        }
      }
      const plantedOffender = offenders.find((o) => o.file === plantedRelPath);
      expect(
        plantedOffender,
        `Expected the planted, gitignored file ${plantedRelPath} to be excluded from the sweep, ` +
          `but it was flagged. The sweep is reading the filesystem instead of the git index.`,
      ).toBeUndefined();
    } finally {
      if (existsSync(plantedAbsPath)) unlinkSync(plantedAbsPath);
    }
  });
});
