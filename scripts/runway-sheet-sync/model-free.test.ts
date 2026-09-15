/**
 * _R1#156, part 1 — prove the sync pipeline is model-free.
 *
 * Verified at 5f33343 by grep: no `anthropic`, `@ai-sdk`, `generateText`, or
 * `streamText` under scripts/runway-sheet-sync. The pipeline is
 * deterministic TypeScript today, but nothing enforced that stays true. This
 * test stubs the AI SDK ("ai") and the Anthropic client ("@ai-sdk/anthropic")
 * at the module boundary — not inside our code — so that if a model call is
 * ever added anywhere in the sync's call graph, this test fails at the
 * moment it is added, not a month later when a walk quietly absorbs the gap.
 *
 * Positive control: a fixture module that DOES call the stubbed AI SDK must
 * throw in this same harness. Without it, a broken mock (e.g. one vitest
 * silently failed to apply) would let both the fixture and the real pipeline
 * pass for the same reason — nothing actually calling through the stub —
 * and the test would prove nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "../../src/lib/runway/test-db";
import { clients, projects } from "../../src/lib/db/runway-schema";
import { getSheetConfig, SHEETS } from "./config";
import type { SheetFixture } from "./types";

/** Every export of the named module throws the moment it is CALLED. Access
 * (e.g. destructuring an import) does not throw — only invocation does,
 * which mirrors how a real model client is actually used. */
function throwingModelModule(moduleName: string) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "__esModule") return true;
        // "then" is probed by module-interop / thenable checks (e.g. this
        // test file's own `await import(...)` of the positive-control
        // fixture), never by real caller code — leaving it non-throwing
        // avoids a false MODEL CALL DETECTED that has nothing to do with a
        // real call into the model client.
        if (prop === "then") return undefined;
        if (typeof prop === "symbol") return undefined;
        return () => {
          throw new Error(
            `MODEL CALL DETECTED: "${moduleName}".${String(prop)}() was called. ` +
              `The sync pipeline is supposed to be model-free (_R1#156).`
          );
        };
      },
      // vitest validates named imports against the mock's own key set before
      // handing back a binding, so a bare `get` trap is not enough — without
      // `has`, every named import (e.g. `generateText`) fails with "no such
      // export" instead of resolving to the throwing stub above.
      has() {
        return true;
      },
    }
  );
}

vi.mock("ai", () => throwingModelModule("ai"));
vi.mock("@ai-sdk/anthropic", () => throwingModelModule("@ai-sdk/anthropic"));

describe("_R1#156 model-free proof", () => {
  it("positive control: a module that calls the AI SDK throws under this harness's stub", async () => {
    const { callsModelBoundary } = await import("./__fixtures__/calls-model-boundary");
    await expect(callsModelBoundary()).rejects.toThrow(/MODEL CALL DETECTED: "ai"\.generateText/);
  });

  describe("the full sync against fixtures, with the model client stubbed to throw", () => {
    const CONFIG = getSheetConfig(SHEETS[0].sheetId)!; // beyond-petro / BPC-2603-01

    let db: TestDb;
    let dbPath: string;
    let fixturesDir: string;
    let outDir: string;

    beforeEach(async () => {
      const t = await createTestDb();
      await seedTestDb(t.client);
      db = t.db;
      dbPath = t.dbPath;

      await db.insert(clients).values({
        id: "cl-156-model-free",
        name: "Beyond Petro",
        slug: "beyond-petro",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.insert(projects).values({
        id: "pj-156-model-free",
        clientId: "cl-156-model-free",
        name: CONFIG.label,
        notes: `${CONFIG.engagementCode} SOW`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      fixturesDir = mkdtempSync(join(tmpdir(), "sheet-sync-fixtures-156-"));
      outDir = mkdtempSync(join(tmpdir(), "sheet-sync-out-156-"));
    });

    afterEach(() => {
      cleanupTestDb(dbPath);
      rmSync(fixturesDir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    });

    it("runs runSheet to completion, proving no code path anywhere in the sync ever touches the model client", async () => {
      const values: (string | undefined)[][] = [
        ["", "CIVILIZATION"],
        [],
        ["", "Beyond Petro | Project Plan"],
        [],
        ["", `${CONFIG.label}  |   ${CONFIG.engagementCode}`],
        [],
        [],
        ["", "OVERALL PROGRESS"],
        [],
        ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE"],
        ["", "FALSE", "Landing Page Build", "", "1-Jun-2026", "30-Jun-2026"],
        ["", "TRUE", "   1.1 Kickoff call", "", "1-Jun-2026", "1-Jun-2026"],
      ];
      const fixture: SheetFixture = {
        sheetId: CONFIG.sheetId,
        tab: "Task Tracker & Gantt Chart",
        range: "A1:N",
        exportedAt: "2026-09-14T00:00:00Z",
        values,
      };
      writeFileSync(join(fixturesDir, `${CONFIG.sheetId}.json`), JSON.stringify(fixture));

      const { runSheet } = await import("../runway-sheet-sync");
      const summary = (await runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false)) as {
        counts: { "leaf-tasks": number };
      };

      expect(summary.counts["leaf-tasks"]).toBe(1);
    });
  });
});
