/**
 * Lint guard: every `create_*` tool exported by bot-tools.ts must be either
 * in INTERCEPT_ALLOWLIST (modal-routed) or INTERCEPT_EXCLUDED (deliberate
 * opt-out). Without this guard a future `create_foo` tool ships and silently
 * bypasses the modal intercept layer.
 *
 * Reads the bot-tools.ts source as raw text and pulls every key matching
 * `^create_[a-z_]+\: tool\(` so we don't have to instantiate the tool factory
 * (which would pull in DB modules).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  INTERCEPT_ALLOWLIST,
  INTERCEPT_EXCLUDED,
} from "./operations-utils";

function extractCreateToolNames(): string[] {
  const path = join(
    process.cwd(),
    "src/lib/slack/bot-tools.ts",
  );
  const src = readFileSync(path, "utf8");
  // Match keys like `create_project: tool(`, `create_week_item: tool(`.
  // Captures the snake-case identifier between leading whitespace + `:` + `tool(`.
  const re = /(^|\s)(create_[a-z_]+)\s*:\s*tool\s*\(/gm;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    names.add(m[2]);
  }
  return [...names];
}

describe("intercept-allowlist lint guard", () => {
  it("can extract at least one create_* tool from bot-tools.ts (sanity)", () => {
    const names = extractCreateToolNames();
    expect(names.length).toBeGreaterThan(0);
  });

  it("every create_* tool is in INTERCEPT_ALLOWLIST or INTERCEPT_EXCLUDED", () => {
    const names = extractCreateToolNames();
    const allowed = new Set<string>([
      ...INTERCEPT_ALLOWLIST,
      ...INTERCEPT_EXCLUDED,
    ]);
    const uncovered = names.filter((n) => !allowed.has(n));
    expect(
      uncovered,
      `Found create_* tools not in INTERCEPT_ALLOWLIST or INTERCEPT_EXCLUDED: ${uncovered.join(", ")}. Add them to one of the constants in src/lib/runway/operations-utils.ts.`,
    ).toEqual([]);
  });

  it("INTERCEPT_ALLOWLIST entries actually exist as bot-tool exports", () => {
    const names = new Set(extractCreateToolNames());
    for (const tool of INTERCEPT_ALLOWLIST) {
      expect(names.has(tool), `INTERCEPT_ALLOWLIST entry '${tool}' is not in bot-tools.ts`).toBe(true);
    }
  });

  it("INTERCEPT_EXCLUDED entries actually exist as bot-tool exports", () => {
    const names = new Set(extractCreateToolNames());
    for (const tool of INTERCEPT_EXCLUDED) {
      expect(names.has(tool), `INTERCEPT_EXCLUDED entry '${tool}' is not in bot-tools.ts`).toBe(true);
    }
  });
});
