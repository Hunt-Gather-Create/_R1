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
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PRE_COMMIT_PATH = join(__dirname, "..", "..", ".githooks", "pre-commit");
// opeff#1390 step 1: pre-commit now REQUIRES voice-lint-local.sh to exist,
// so every fixture built by initFixture needs its own copy, or the code-file
// dash arm this suite exists to test never even runs, refused one step
// earlier at the missing-file check instead.
const VOICE_LINT_LOCAL_PATH = join(__dirname, "..", "..", ".githooks", "voice-lint-local.sh");

// opeff#1390 step 1, TP's ruling after this suite went red on CI: GitHub
// Actions has no agencyos mirror at any path, and provisioning one there
// means cloning a private opeff repo with a credential this repo does not
// own, a workflow change routed to Overwatch separately, not done here.
// Split, following civ-substrate's own opeff#1361 precedent exactly:
// tests of the REAL core's own behavior (opeff owns and tests those) skip
// with a named reason when no live mirror exists; tests of _R1's OWN
// wiring, the local arm, the required-file checks, the secret arm, run
// EVERYWHERE by handing the loader a minimal STUB core in a fake HOME, so
// it clears the core-loader step without depending on the real one. The
// stub proves it was actually sourced by writing a marker to stderr; a
// loader that silently skipped the core would otherwise pass these tests
// for the wrong reason.
const MIRROR_CORE = join(homedir(), ".local", "agencyos", "main", "agencyos-operational-efficiency", "hooks", "voice-lint-core.sh");
const HAVE_MIRROR = existsSync(MIRROR_CORE);
if (!HAVE_MIRROR) {
  // Collection-time print, not inside a test body, so it survives whichever
  // reporter runs it, same fix as _R1#187's own skip-reason visibility gap.
  console.error(
    `pre-commit.test.ts: no live agencyos mirror at ${MIRROR_CORE}; the real-core tests below are SKIPPED for this reason (opeff#1390 step 1). _R1's own wiring tests still run, against a stub core.`,
  );
}
const STUB_CORE_MARKER = "STUB-CORE-SOURCED-marker-opeff1390";

function writeStubCore(fakeHome: string): void {
  const coreDir = join(fakeHome, ".local", "agencyos", "main", "agencyos-operational-efficiency", "hooks");
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(join(coreDir, "voice-lint-core.sh"), `echo "${STUB_CORE_MARKER}" >&2\n`);
}

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
function commitWithEnv(workDir: string, message: string, env: NodeJS.ProcessEnv): CommitResult {
  const before = git(["rev-parse", "HEAD"], workDir);
  const result = spawnSync(
    "git",
    [...GIT_IDENTITY, "commit", "-m", message],
    { cwd: workDir, encoding: "utf8", env, timeout: 15000 },
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

function commit(workDir: string, message: string): CommitResult {
  return commitWithEnv(workDir, message, ISOLATED_GIT_ENV);
}

/**
 * For tests of _R1's OWN wiring, the local arm, the required-file checks,
 * the secret arm, which must run in CI whether or not a live agencyos
 * mirror exists there. Builds a fresh temp HOME per call with a stub core
 * that only proves it was sourced (a marker to stderr) and never blocks,
 * so the loader clears the core step and reaches the arm under test.
 */
function commitWithStubCore(workDir: string, message: string): CommitResult {
  const fakeHome = mkdtempSync(join(tmpdir(), "pre-commit-stub-home-"));
  writeStubCore(fakeHome);
  try {
    return commitWithEnv(workDir, message, { ...ISOLATED_GIT_ENV, HOME: fakeHome });
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
}

function initFixture(root: string): string {
  const workDir = join(root, "work");
  mkdirSync(workDir, { recursive: true });
  git(["init", "--quiet", "-b", "main"], workDir);
  mkdirSync(join(workDir, ".githooks"), { recursive: true });
  execFileSync("cp", [PRE_COMMIT_PATH, join(workDir, ".githooks", "pre-commit")]);
  execFileSync("cp", [VOICE_LINT_LOCAL_PATH, join(workDir, ".githooks", "voice-lint-local.sh")]);
  execFileSync("chmod", ["+x", join(workDir, ".githooks", "pre-commit")]);
  git(["config", "core.hooksPath", join(workDir, ".githooks")], workDir);
  writeFile(workDir, "README.md", "root\n");
  git(["add", "."], workDir);
  // --no-verify: this is fixture scaffolding, not the commit under test, and
  // must land the same way whether or not a live agencyos mirror exists on
  // this machine. Every test below drives its OWN, deliberate commit through
  // the real hook; this one only exists so that commit has a parent.
  git(["commit", "--quiet", "--no-verify", "-m", "root"], workDir);
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

  it("acceptance 1 (_R1 wiring, runs everywhere): a staged .ts file with an em dash in a comment is refused by the local arm, exit 1, HEAD unchanged", () => {
    const workDir = initFixture(root);
    const beforeHead = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, "src/example.ts", `// a comment with a dash ${EM_DASH} on purpose\nexport const x = 1;\n`);
    git(["add", "src/example.ts"], workDir);

    const result = commitWithStubCore(workDir, "add ts file with em dash comment");
    expect(result.status).not.toBe(0);
    expect(result.combined).toMatch(STUB_CORE_MARKER);
    expect(result.combined).toMatch(/pre-commit BLOCK \(fleet voice\)/);
    expect(result.combined).toMatch(/\.ts/);
    expect(result.combined).toMatch(/Bypass only if certain: git commit --no-verify/);
    expect(result.head).toBe(beforeHead);
  });

  it.skipIf(!HAVE_MIRROR)(
    HAVE_MIRROR
      ? "acceptance 2a (real core): an en dash in a .mjs string literal is refused by the central core"
      : `acceptance 2a (real core): SKIPPED, no live agencyos mirror at ${MIRROR_CORE}`,
    () => {
      const workDir = initFixture(root);
      const mjsHead = git(["rev-parse", "HEAD"], workDir);
      writeFile(workDir, "scripts/example.mjs", `export const label = "a value ${EN_DASH} on purpose";\n`);
      git(["add", "scripts/example.mjs"], workDir);
      const mjsResult = commit(workDir, "add mjs file with en dash string");
      expect(mjsResult.status).not.toBe(0);
      expect(mjsResult.combined).toMatch(/\[opeff#1347 voice-lint-core\]/);
      expect(mjsResult.combined).toMatch(/example\.mjs/);
      expect(mjsResult.head).toBe(mjsHead);
    },
  );

  it("acceptance 2b (_R1 wiring, runs everywhere): an em dash in a .sh comment is refused by the local arm, since the central core does not cover .sh", () => {
    const workDir = initFixture(root);
    const shHead = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, "scripts/example.sh", `#!/bin/sh\n# a comment with a dash ${EM_DASH} on purpose\necho hi\n`);
    git(["add", "scripts/example.sh"], workDir);
    const shResult = commitWithStubCore(workDir, "add sh file with em dash comment");
    expect(shResult.status).not.toBe(0);
    expect(shResult.combined).toMatch(STUB_CORE_MARKER);
    expect(shResult.combined).toMatch(/pre-commit BLOCK \(fleet voice\)/);
    expect(shResult.combined).toMatch(/\.sh/);
    expect(shResult.head).toBe(shHead);
  });

  it("acceptance 3 (_R1 wiring, runs everywhere): a .ts file with only hyphens commits, and touching a pre-existing dash line without adding a new one commits", () => {
    const workDir = initFixture(root);

    writeFile(workDir, "src/hyphen-only.ts", "// a hyphen-only comment, fine\nexport const y = 2;\n");
    git(["add", "src/hyphen-only.ts"], workDir);
    const cleanResult = commitWithStubCore(workDir, "add ts file with only hyphens");
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
    const touchResult = commitWithStubCore(workDir, "add unrelated line, no new dash");
    expect(touchResult.status).toBe(0);
  });

  it.skipIf(!HAVE_MIRROR)(
    HAVE_MIRROR
      ? "acceptance 4a (real core): a .md file with an em dash is refused by the central core"
      : `acceptance 4a (real core): SKIPPED, no live agencyos mirror at ${MIRROR_CORE}`,
    () => {
      const workDir = initFixture(root);
      const mdHead = git(["rev-parse", "HEAD"], workDir);
      writeFile(workDir, "notes.md", `# notes\n\nThis line has an em dash ${EM_DASH} on purpose.\n`);
      git(["add", "notes.md"], workDir);
      const mdResult = commit(workDir, "add md file with em dash");
      expect(mdResult.status).not.toBe(0);
      expect(mdResult.combined).toMatch(/\[opeff#1347 voice-lint-core\]/);
      expect(mdResult.combined).toMatch(/notes\.md/);
      expect(mdResult.head).toBe(mdHead);
    },
  );

  it("acceptance 4b (_R1 wiring, runs everywhere): the secret arm still refuses a staged .env", () => {
    const workDir = initFixture(root);
    const envHead = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, ".env", "SECRET=value\n");
    git(["add", ".env"], workDir);
    const envResult = commitWithStubCore(workDir, "add env file");
    expect(envResult.status).not.toBe(0);
    expect(envResult.combined).toMatch(STUB_CORE_MARKER);
    expect(envResult.combined).toMatch(/pre-commit BLOCK: possible secret file/);
    expect(envResult.head).toBe(envHead);
  });

  it("acceptance 5 (_R1 wiring, runs everywhere): a missing voice-lint-local.sh refuses a clean commit, naming the path, rather than silently skipping the code-file arm", () => {
    const workDir = initFixture(root);
    rmSync(join(workDir, ".githooks", "voice-lint-local.sh"));

    const head = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, "src/clean.ts", "export const x = 1;\n");
    git(["add", "src/clean.ts"], workDir);
    const result = commitWithStubCore(workDir, "clean ts commit, local script missing");
    expect(result.status).not.toBe(0);
    expect(result.combined).toMatch(STUB_CORE_MARKER);
    expect(result.combined).toMatch(/voice-lint-local\.sh is missing or unreadable/);
    expect(result.combined).toMatch(/voice-lint-local\.sh/);
    expect(result.head).toBe(head);
  });

  it("mutation control (proves the stub is load bearing): a stub core placed at the WRONG path is never sourced, so its marker never appears, and the loader's own missing-core refusal fires instead", () => {
    const workDir = initFixture(root);
    const fakeHome = mkdtempSync(join(tmpdir(), "pre-commit-stub-wrong-"));
    // Deliberately one directory too shallow: the loader's hardcoded mirror
    // path is $HOME/.local/agencyos/main/agencyos-operational-efficiency/
    // hooks/voice-lint-core.sh, so writing the stub at .../main/ instead of
    // one level deeper means the loader's own [ ! -r ] check fires before
    // this stub is ever read, let alone sourced.
    const wrongDir = join(fakeHome, ".local", "agencyos", "main");
    mkdirSync(wrongDir, { recursive: true });
    writeFileSync(join(wrongDir, "voice-lint-core.sh"), `echo "${STUB_CORE_MARKER}" >&2\n`);

    writeFile(workDir, "src/clean.ts", "export const x = 1;\n");
    git(["add", "src/clean.ts"], workDir);
    try {
      const result = commitWithEnv(workDir, "clean ts, stub at wrong path", { ...ISOLATED_GIT_ENV, HOME: fakeHome });
      expect(result.combined).not.toMatch(STUB_CORE_MARKER);
      expect(result.combined).toMatch(/\[opeff#1347 voice-lint-core\]/);
      expect(result.combined).toMatch(/canonical core is missing or unreadable/);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("acceptance 6 (_R1 wiring, runs everywhere): an unreachable central voice-lint core refuses a clean commit, naming the path, rather than silently skipping the markdown arm", () => {
    const workDir = initFixture(root);

    const head = git(["rev-parse", "HEAD"], workDir);
    writeFile(workDir, "src/clean.ts", "export const x = 1;\n");
    git(["add", "src/clean.ts"], workDir);
    const fakeHome = join(root, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    const result = spawnSync(
      "git",
      [...GIT_IDENTITY, "commit", "-m", "clean ts commit, core missing"],
      { cwd: workDir, encoding: "utf8", env: { ...ISOLATED_GIT_ENV, HOME: fakeHome }, timeout: 15000 },
    );
    const combined = (result.stdout ?? "") + (result.stderr ?? "");
    expect(result.status).not.toBe(0);
    expect(combined).toMatch(/\[opeff#1347 voice-lint-core\]/);
    expect(combined).toMatch(/voice-lint-core\.sh/);
    const headAfter = git(["rev-parse", "HEAD"], workDir);
    expect(headAfter).toBe(head);
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
