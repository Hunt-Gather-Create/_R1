/**
 * Sanitization gate for Slack fixtures.
 *
 * Reads every fixture file under `tests/fixtures/slack/` and asserts none
 * contain real-shape Slack IDs. Real Slack IDs match patterns like
 *   - team:    `T` followed by 8-12 alphanumerics  (e.g. `T0CAG3KR4`)
 *   - user:    `U` followed by 8-12 alphanumerics  (e.g. `U02ABCD1234`)
 *   - channel: `C` / `D` / `G` followed by 8-12 alphanumerics
 *   - bot:     `B` followed by 8-12 alphanumerics
 *   - app:     `A` followed by 8-12 alphanumerics
 *   - view:    `V` followed by 8-12 alphanumerics
 *   - enterprise: `E` followed by 8-12 alphanumerics
 *
 * Sanitized fixtures use the explicit prefix `_TEST_` (e.g. `T_TEST_001`,
 * `U_TEST_001`, `C_TEST_001`, `V_TEST_001`) so the underscore breaks the
 * real-shape regex. Trigger IDs follow Slack shape (`<int>.<int>.<hex>`)
 * but use obvious test values so they can't conflict with real prod data.
 *
 * Any new fixture that fails this gate must be re-sanitized before commit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const FIXTURE_DIR = join(__dirname, "slack");

// Match real-shape Slack IDs:
//   prefix letter then 8-12 alphanumerics (uppercase letters + digits),
//   not preceded by `_` or letter (so `T_TEST_001` and `BOT123` don't match),
//   not followed by alphanumeric (so we land on a full ID, not a substring).
//
// Slack IDs are 9-11 chars typically; we widen to 8-12 for safety. We do NOT
// match shorter values so we don't false-positive on `B0` etc.
const REAL_ID_REGEX = /(?<![A-Za-z0-9_])([TUCDGBAEV])([0-9A-Z]{8,12})(?![A-Za-z0-9])/g;

// Allow-list: known Slack-shape sanitized values that happen to look real-ish
// but are obviously test values. Empty for now — `_TEST_` prefix breaks the
// regex naturally (the underscore is excluded by the `[0-9A-Z]` body class).
const ALLOWED_LITERALS: ReadonlySet<string> = new Set();

function findRealShapeIds(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(REAL_ID_REGEX)) {
    const literal = m[0];
    if (ALLOWED_LITERALS.has(literal)) continue;
    hits.push(literal);
  }
  return hits;
}

describe("Slack fixture sanitization gate", () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));

  it("has the expected fixture files", () => {
    const expected = [
      "block-actions-button-click.json",
      "block-actions-checkbox-toggle.json",
      "block-actions-multi-detect-chain.json",
      "view-submission-task.json",
      "view-submission-project.json",
      "view-submission-retainer.json",
      "view-submission-team-member.json",
      "view-closed.json",
      "slash-command-create.json",
      "slash-command-edit-multimatch.json",
      "event-callback-message.json",
    ];
    for (const name of expected) {
      expect(files, `expected fixture file: ${name}`).toContain(name);
    }
  });

  for (const file of files) {
    it(`${file} parses as valid JSON`, () => {
      const raw = readFileSync(join(FIXTURE_DIR, file), "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it(`${file} contains no real-shape Slack IDs`, () => {
      const raw = readFileSync(join(FIXTURE_DIR, file), "utf-8");
      const hits = findRealShapeIds(raw);
      expect(
        hits,
        `Fixture ${file} contains real-shape Slack IDs: ${hits.join(", ")}. ` +
          `Use the _TEST_ sanitization prefix (e.g. T_TEST_001).`
      ).toEqual([]);
    });

    it(`${file} uses sanitized team/user/channel/view IDs where present`, () => {
      const raw = readFileSync(join(FIXTURE_DIR, file), "utf-8");
      const json = JSON.parse(raw) as unknown;

      // Recursively walk and collect any value at sensitive keys.
      const collected: Array<{ key: string; value: string }> = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const item of node) walk(item);
          return;
        }
        if (node && typeof node === "object") {
          for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            if (typeof v === "string") {
              if (
                k === "team_id" ||
                k === "user_id" ||
                k === "channel_id" ||
                k === "view_id"
              ) {
                collected.push({ key: k, value: v });
              }
            }
            walk(v);
          }
        }
      };
      walk(json);

      for (const { key, value } of collected) {
        // Must include _TEST_ marker
        expect(
          value,
          `${file}: ${key}=${value} must contain '_TEST_' marker`
        ).toMatch(/_TEST_/);
      }
    });
  }
});
