import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations
import {
  EXPECTED_TABLES,
  EXPECTED_META_KEYS,
  checkSchemaParity,
  assertParityResult,
  runSchemaParityCheck,
} from "./runway-schema-parity-check.mjs";

// The parity script stays plain Node so it can run inside the build before
// any TS toolchain, which means it can't import runway-schema.ts and must
// hardcode the table list. These tests are the drift guard: the hardcoded
// list must match the schema file's sqliteTable(...) names exactly.
describe("EXPECTED_TABLES stays in lockstep with runway-schema.ts", () => {
  const schemaSource = readFileSync(
    join(__dirname, "..", "src", "lib", "db", "runway-schema.ts"),
    "utf-8"
  );

  it("matches the sqliteTable names in the schema file, exactly", () => {
    const schemaTables = [...schemaSource.matchAll(/sqliteTable\(\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((name, i, all) => all.indexOf(name) === i)
      .sort();
    expect([...EXPECTED_TABLES].sort()).toEqual(schemaTables);
  });

  it("every sqliteTable declaration is parseable by the name regex", () => {
    // A table declared with single quotes, a template literal, or a variable
    // name would be invisible to the name regex above and let EXPECTED_TABLES
    // rot silently. Count all declarations and require the name regex to have
    // seen every one of them.
    const declarationCount = (schemaSource.match(/=\s*sqliteTable\(/g) ?? []).length;
    const parseableCount = [...schemaSource.matchAll(/sqliteTable\(\s*"([^"]+)"/g)].length;
    expect(parseableCount).toBe(declarationCount);
    expect(declarationCount).toBeGreaterThan(0);
  });

  it("expected _meta seed keys match the INSERTs in runway-schema-push.mjs", () => {
    const pushSource = readFileSync(join(__dirname, "runway-schema-push.mjs"), "utf-8");
    const seededKeys = [
      ...pushSource.matchAll(/INSERT INTO _meta \(key, value, updated_at\) VALUES \('([^']+)'/g),
    ]
      .map((m) => m[1])
      .sort();
    expect([...EXPECTED_META_KEYS].sort()).toEqual(seededKeys);
  });

  it("runway-schema-push.mjs runs the parity check after seeding _meta", () => {
    // main() spawns drizzle-kit, so the wiring can't be exercised in a unit
    // test — pin it at the source level instead: the parity call must appear
    // after the seedMetaRows() call in the push flow.
    const pushSource = readFileSync(join(__dirname, "runway-schema-push.mjs"), "utf-8");
    expect(pushSource).toMatch(/await seedMetaRows\(\);[\s\S]*await runSchemaParityCheck\(\);/);
  });
});

type ExecuteArg = string | { sql: string; args: unknown[] };

function fakeClient(opts: {
  missingTables?: string[];
  metaKeys?: string[];
  failWith?: Error;
}) {
  const missing = new Set(opts.missingTables ?? []);
  const metaKeys = new Set(opts.metaKeys ?? EXPECTED_META_KEYS);
  const client = {
    closed: false,
    async execute(arg: ExecuteArg) {
      if (opts.failWith) throw opts.failWith;
      if (typeof arg === "string") {
        const table = arg.match(/FROM "([^"]+)"/)?.[1] ?? "";
        if (missing.has(table)) {
          throw new Error(`no such table: ${table}`);
        }
        return { rows: [] };
      }
      if (!arg.sql.includes(`FROM "_meta"`)) {
        throw new Error(`unexpected parameterized query: ${arg.sql}`);
      }
      const key = String(arg.args[0]);
      return { rows: metaKeys.has(key) ? [{ 1: 1 }] : [] };
    },
    close() {
      client.closed = true;
    },
  };
  return client;
}

describe("checkSchemaParity", () => {
  it("passes when every table and _meta key is present", async () => {
    const result = await checkSchemaParity(fakeClient({}));
    expect(result).toEqual({ ok: true, missingTables: [], missingMetaKeys: [] });
  });

  it("collects every missing table instead of stopping at the first", async () => {
    const result = await checkSchemaParity(
      fakeClient({ missingTables: ["sections", "sheet_registry", "sheet_sync_ledger"] })
    );
    expect(result.ok).toBe(false);
    expect(result.missingTables).toEqual(["sections", "sheet_registry", "sheet_sync_ledger"]);
    expect(result.missingMetaKeys).toEqual([]);
  });

  it("reports missing _meta seed keys individually", async () => {
    const result = await checkSchemaParity(fakeClient({ metaKeys: ["schema_version"] }));
    expect(result.ok).toBe(false);
    expect(result.missingTables).toEqual([]);
    expect(result.missingMetaKeys).toEqual(["feature_flags"]);
  });

  it("reports all seed keys unreachable when _meta itself is missing", async () => {
    const result = await checkSchemaParity(fakeClient({ missingTables: ["_meta"] }));
    expect(result.ok).toBe(false);
    expect(result.missingTables).toEqual(["_meta"]);
    expect(result.missingMetaKeys).toEqual(EXPECTED_META_KEYS);
  });

  it("rethrows non-schema errors instead of reporting them as missing tables", async () => {
    // An auth rotation or network failure must surface as itself, not as
    // "all 12 tables missing" — that misdirects incident response.
    await expect(
      checkSchemaParity(fakeClient({ failWith: new Error("401 unauthorized: token expired") }))
    ).rejects.toThrow("401 unauthorized");
  });
});

describe("runSchemaParityCheck (the build-failing entry point)", () => {
  it("throws a FAILED error listing every gap, and closes the client", async () => {
    const client = fakeClient({ missingTables: ["sections"], metaKeys: ["schema_version"] });
    await expect(runSchemaParityCheck(client)).rejects.toThrow(
      "Runway schema parity check FAILED — missing tables: sections; missing _meta keys: feature_flags"
    );
    expect(client.closed).toBe(true);
  });

  it("resolves quietly when parity holds, and closes the client", async () => {
    const client = fakeClient({});
    await expect(runSchemaParityCheck(client)).resolves.toBeUndefined();
    expect(client.closed).toBe(true);
  });

  it("throws when RUNWAY_DATABASE_URL is missing and no client is injected", async () => {
    const original = process.env.RUNWAY_DATABASE_URL;
    delete process.env.RUNWAY_DATABASE_URL;
    try {
      await expect(runSchemaParityCheck()).rejects.toThrow("RUNWAY_DATABASE_URL is required");
    } finally {
      if (original !== undefined) process.env.RUNWAY_DATABASE_URL = original;
    }
  });
});

describe("assertParityResult", () => {
  it("returns the pass line for an ok result", () => {
    expect(assertParityResult({ ok: true, missingTables: [], missingMetaKeys: [] })).toContain(
      "parity check passed"
    );
  });

  it("throws with only the failing section when just tables are missing", () => {
    expect(() =>
      assertParityResult({ ok: false, missingTables: ["sections"], missingMetaKeys: [] })
    ).toThrow("Runway schema parity check FAILED — missing tables: sections");
  });

  it("throws with only the failing section when just _meta keys are missing", () => {
    expect(() =>
      assertParityResult({ ok: false, missingTables: [], missingMetaKeys: ["feature_flags"] })
    ).toThrow("Runway schema parity check FAILED — missing _meta keys: feature_flags");
  });
});
