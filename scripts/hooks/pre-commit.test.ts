/**
 * _R1#184: .githooks/pre-commit's dash check only covered added lines in
 * staged *.md files. 19 dash lines in .ts comments and report strings
 * reached a PR ungated because the code arm did not exist. The fleet voice
 * rule covers everything a person reads, including code comments and
 * strings, not just markdown.
 *
 * This suite drives the REAL, installed .githooks/pre-commit through a real
 * `git commit`, same discipline as scripts/hooks/pre-push.test.ts: assert on
 * the commit's own exit code, printed output, and whether HEAD moved, never
 * by reading the hook's source and reasoning about what it should do.
 *
 * Fixtures are local, offline git repos, same isolation discipline as
 * scripts/hygiene-guard.test.ts and scripts/hooks/pre-push.test.ts:
 * GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR stripped from every
 * git invocation, so a hook process never accidentally resolves against the
 * real repository this suite itself runs inside of.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PRE_COMMIT_PATH = join(__dirname, "..", "..", ".githooks", "pre-commit");

const ISOLATED_GIT_ENV = { ...process.env };
delete ISOLATED_GIT_ENV.GIT_DIR;
delete ISOLATED_GIT_ENV.GIT_WORK_TREE;
delete ISOLATED_GIT_ENV.GIT_INDEX_FILE;
delete ISOLATED_GIT_ENV.GIT_COMMON_DIR;

const GIT_IDENTITY = [
  "-c",
  "user.name=pre-commit-test",
  "-c",
  "user.email=pre-commit-test@example.invalid",
  "-c",
  "gc.auto=0",
];

function git(args: string[], cwd: string): string {
  return execFileSync("git", [...GIT_IDENTITY, ...args], {
    cwd,
    encoding: "utf8",
    env: ISOLATED_GIT_ENV,
  }).trim();
}

function writeFile(dir: string, name: string, content: string) {
  const full = join(dir, name);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

interface CommitResult {
  status: number;
  combined: string;
  head: string;
}

/** A hard 15s timeout: the fleet rule requires every test that runs the
 * code under test to have one, so a hung hook fails the test, not the run. */
function commit(workDir: string, message: string): CommitResult {
  const before = git(["rev-parse", "HEAD"], workDir);
  const result = spawnSync(
    "git",
    [...GIT_IDENTITY, "commit", "-m", message],
    { cwd: workDir, encoding: "utf8", env: ISOLATED_GIT_ENV, timeout: 15000 },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  let head = before;
  try {
    head = git(["rev-parse", "HEAD"], workDir);
  } catch {
    // no commits yet
  }
  return { status: result.status ?? -1, combined: stdout + stderr, head };
}

function initFixture(root: string): string {
  const workDir = join(root, "work");
  mkdirSync(workDir, { recursive: true });
  git(["init", "--quiet", "-b", "main"], workDir);
  mkdirSync(join(workDir, ".githooks"), { recursive: true });
  execFileSync("cp", [PRE_COMMIT_PATH, join(workDir, ".githooks", "pre-commit")]);
  execFileSync("chmod", ["+x", join(workDir, ".githooks", "pre-commit")]);
  git(["config", "core.hooksPath", join(workDir, ".githooks")], workDir);
  writeFile(workDir, "README.md", "root\n");
  git(["add", "."], workDir);
  git(["commit", "--quiet", "-m", "root"], workDir);
  return workDir;
}

// Escape sequences, not literal glyphs: this hook checks *.ts files too, so
// a literal em/en dash character here would refuse this file's own commit.
const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

describe(".githooks/pre-commit, code-file dash arm (_R1#184)", () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "pre-commit-code-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("acceptance 1: a staged .ts file with an em dash in a comment is refused, exit 1, HEAD unchanged", () => {
    const workDir = initFixture(root);
    const beforeHead = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, "src/example.ts", `// a comment with a dash ${EM_DASH} on purpose\nexport const x = 1;\n`);
    git(["add", "src/example.ts"], workDir);

    const result = commit(workDir, "add ts file with em dash comment");
    expect(result.status).not.toBe(0);
    expect(result.combined).toMatch(/pre-commit BLOCK \(fleet voice\)/);
    expect(result.combined).toMatch(/\.ts/);
    expect(result.combined).toMatch(/Bypass only if certain: git commit --no-verify/);
    expect(result.head).toBe(beforeHead);
  });

  it("acceptance 2: an en dash in a .mjs string literal and a .sh comment are both refused", () => {
    const workDir = initFixture(root);

    const mjsHead = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, "scripts/example.mjs", `export const label = "a value ${EN_DASH} on purpose";\n`);
    git(["add", "scripts/example.mjs"], workDir);
    const mjsResult = commit(workDir, "add mjs file with en dash string");
    expect(mjsResult.status).not.toBe(0);
    expect(mjsResult.combined).toMatch(/pre-commit BLOCK \(fleet voice\)/);
    expect(mjsResult.combined).toMatch(/\.mjs/);
    expect(mjsResult.head).toBe(mjsHead);
    git(["reset", "--", "scripts/example.mjs"], workDir);
    rmSync(join(workDir, "scripts", "example.mjs"));

    const shHead = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, "scripts/example.sh", `#!/bin/sh\n# a comment with a dash ${EM_DASH} on purpose\necho hi\n`);
    git(["add", "scripts/example.sh"], workDir);
    const shResult = commit(workDir, "add sh file with em dash comment");
    expect(shResult.status).not.toBe(0);
    expect(shResult.combined).toMatch(/pre-commit BLOCK \(fleet voice\)/);
    expect(shResult.combined).toMatch(/\.sh/);
    expect(shResult.head).toBe(shHead);
  });

  it("acceptance 3: a .ts file with only hyphens commits, and touching a pre-existing dash line without adding a new one commits", () => {
    const workDir = initFixture(root);

    writeFile(workDir, "src/hyphen-only.ts", "// a hyphen-only comment, fine\nexport const y = 2;\n");
    git(["add", "src/hyphen-only.ts"], workDir);
    const cleanResult = commit(workDir, "add ts file with only hyphens");
    expect(cleanResult.status).toBe(0);

    // Land a pre-existing dash line on main, outside this suite's own hook run.
    writeFile(workDir, "src/preexisting.ts", `// pre-existing dash ${EM_DASH} line\nexport const z = 3;\n`);
    git(["add", "src/preexisting.ts"], workDir);
    git(["-c", "user.name=pre-commit-test", "-c", "user.email=pre-commit-test@example.invalid", "commit", "--no-verify", "-m", "seed pre-existing dash line"], workDir);

    // Touch the file WITHOUT adding a new line containing a dash.
    writeFile(
      workDir,
      "src/preexisting.ts",
      `// pre-existing dash ${EM_DASH} line\nexport const z = 3;\nexport const w = 4;\n`,
    );
    git(["add", "src/preexisting.ts"], workDir);
    const touchResult = commit(workDir, "add unrelated line, no new dash");
    expect(touchResult.status).toBe(0);
  });

  it("acceptance 4: the markdown arm still refuses a dash and the secret arm still refuses a staged .env, byte-identical behaviour", () => {
    const workDir = initFixture(root);

    const mdHead = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, "notes.md", `# notes\n\nThis line has an em dash ${EM_DASH} on purpose.\n`);
    git(["add", "notes.md"], workDir);
    const mdResult = commit(workDir, "add md file with em dash");
    expect(mdResult.status).not.toBe(0);
    expect(mdResult.combined).toMatch(/pre-commit BLOCK \(fleet voice\): em\/en dash in newly added markdown/);
    expect(mdResult.head).toBe(mdHead);
    git(["reset", "--", "notes.md"], workDir);
    rmSync(join(workDir, "notes.md"));

    const envHead = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, ".env", "SECRET=value\n");
    git(["add", ".env"], workDir);
    const envResult = commit(workDir, "add env file");
    expect(envResult.status).not.toBe(0);
    expect(envResult.combined).toMatch(/pre-commit BLOCK: possible secret file/);
    expect(envResult.head).toBe(envHead);
  });

  it("mutation control: with the code arm removed, acceptance 1's em-dash .ts comment commits clean (proves the test is non-vacuous)", () => {
    const workDir = initFixture(root);
    // Simulate the pre-fix hook by installing the byte-identical fleet
    // markdown+secret arms only, with no code-file arm at all.
    const preFixHook = `#!/bin/sh
_added_md=$(git diff --cached --unified=0 --diff-filter=ACM -- '*.md' 2>/dev/null | grep -E '^\\+' | grep -v '^+++' || true)
if [ -n "$_added_md" ]; then
  _hits=$(printf '%s\\n' "$_added_md" | perl -CS -ne 'print if /[\\x{2013}\\x{2014}]/')
  if [ -n "$_hits" ]; then
    echo "pre-commit BLOCK (fleet voice): em/en dash in newly added markdown. Use hyphen, period, comma, colon, semicolon."
    printf '%s\\n' "$_hits" | head -5
    echo "Bypass only if certain: git commit --no-verify"
    exit 1
  fi
fi
_secrets=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '(^|/)(\\.env|.*\\.pem|.*_rsa|.*\\.p12|id_ed25519)$' || true)
if [ -n "$_secrets" ]; then
  echo "pre-commit BLOCK: possible secret file(s) staged:"
  printf '%s\\n' "$_secrets"
  echo "Bypass only if certain: git commit --no-verify"
  exit 1
fi
`;
    writeFileSync(join(workDir, ".githooks", "pre-commit"), preFixHook);
    execFileSync("chmod", ["+x", join(workDir, ".githooks", "pre-commit")]);

    writeFile(workDir, "src/example.ts", `// a comment with a dash ${EM_DASH} on purpose\nexport const x = 1;\n`);
    git(["add", "src/example.ts"], workDir);
    const result = commit(workDir, "add ts file with em dash comment, pre-fix hook");
    expect(result.status).toBe(0);
  });
});
