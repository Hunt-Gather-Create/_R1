import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations
import {
  EXPECTED_TABLES,
  EXPECTED_COLUMNS,
  EXPECTED_META_KEYS,
  checkSchemaParity,
  assertParityResult,
  runSchemaParityCheck,
} from "./runway-schema-parity-check.mjs";

// The parity script stays plain Node so it can run inside the build before
// any TS toolchain, which means it can't import runway-schema.ts and must
// hardcode its expectations. These tests are the drift guard: the hardcoded
// structures must match the schema file exactly.
describe("EXPECTED_TABLES stays in lockstep with runway-schema.ts", () => {
  // Comment lines are stripped so the commented-out L5 door declaration
  // (parentTaskId) never counts as a live column or table.
  const schemaSource = readFileSync(
    join(__dirname, "..", "src", "lib", "db", "runway-schema.ts"),
    "utf-8"
  )
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

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

  // Holdout M1 lockstep extension: every table covered by EXPECTED_COLUMNS
  // asserts EXACT equality with its schema block's SQL column names, so
  // adding a column to runway-schema.ts without updating the map fails loud.
  function schemaColumnsFor(table: string): { columns: string[]; declarationCount: number } {
    const blockMatch = schemaSource.match(
      new RegExp(`sqliteTable\\(\\s*"${table}",\\s*\\{([\\s\\S]*?)\\n\\}`)
    );
    expect(blockMatch, `sqliteTable block for ${table} not found`).toBeTruthy();
    const block = blockMatch![1];
    const columns = [...block.matchAll(/^\s+\w+:\s*(?:text|integer|real|blob)\(\s*"([^"]+)"/gm)].map(
      (m) => m[1]
    );
    // Parseability guard, same idea as the table-name count: any column
    // declared via an unrecognized builder or quote style must fail loud
    // rather than silently escape the equality check.
    const declarationCount = (block.match(/^\s+\w+:\s*\w+\(/gm) ?? []).length;
    return { columns, declarationCount };
  }

  for (const table of Object.keys(EXPECTED_COLUMNS) as Array<keyof typeof EXPECTED_COLUMNS>) {
    it(`EXPECTED_COLUMNS.${table} matches the schema block exactly`, () => {
      const { columns, declarationCount } = schemaColumnsFor(table as string);
      expect(columns.length).toBe(declarationCount);
      expect([...EXPECTED_COLUMNS[table]].sort()).toEqual([...columns].sort());
    });
  }

  it("every EXPECTED_COLUMNS table is also in EXPECTED_TABLES", () => {
    for (const table of Object.keys(EXPECTED_COLUMNS)) {
      expect(EXPECTED_TABLES).toContain(table);
    }
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

  it("drizzle config points at exactly the schema file this guard reads (L1)", () => {
    // If a second schema file were ever added to drizzle-runway.config.ts,
    // this whole lockstep guard would be silently blind to it. Pin the config.
    const configSource = readFileSync(join(__dirname, "..", "drizzle-runway.config.ts"), "utf-8");
    const schemaField = configSource.match(/schema:\s*"([^"]+)"/)?.[1];
    expect(schemaField).toBe("./src/lib/db/runway-schema.ts");
  });
});

type ExecuteArg = string | { sql: string; args: unknown[] };

function fakeClient(opts: {
  missingTables?: string[];
  missingColumns?: Record<string, string[]>;
  metaKeys?: string[];
  failWith?: Error;
}) {
  const missing = new Set(opts.missingTables ?? []);
  const missingCols = opts.missingColumns ?? {};
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
        // Column probes select explicit quoted columns; existence probes
        // select the literal 1. Mirror SQLite: error names the first missing.
        const selected = [...arg.matchAll(/SELECT (.+) FROM/g)][0]?.[1] ?? "";
        if (selected !== "1") {
          const requested = [...selected.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
          const gone = requested.find((c) => (missingCols[table] ?? []).includes(c));
          if (gone) {
            throw new Error(`no such column: ${gone}`);
          }
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

const CLEAN = { ok: true, missingTables: [], missingColumns: [], missingMetaKeys: [] };

describe("checkSchemaParity", () => {
  it("passes when every table, column, and _meta key is present", async () => {
    const result = await checkSchemaParity(fakeClient({}));
    expect(result).toEqual(CLEAN);
  });

  it("collects every missing table instead of stopping at the first", async () => {
    const result = await checkSchemaParity(
      fakeClient({ missingTables: ["sections", "sheet_registry", "sheet_sync_ledger"] })
    );
    expect(result.ok).toBe(false);
    expect(result.missingTables).toEqual(["sections", "sheet_registry", "sheet_sync_ledger"]);
    expect(result.missingColumns).toEqual([]);
    expect(result.missingMetaKeys).toEqual([]);
  });

  it("detects missing columns on an existing table (the Holdout M1 shape)", async () => {
    // The incident's own migration was two-tenths columns: week_items gained
    // section_id + task_no. A table-only check ships green on this DB shape.
    const result = await checkSchemaParity(
      fakeClient({ missingColumns: { week_items: ["section_id", "task_no"] } })
    );
    expect(result.ok).toBe(false);
    expect(result.missingTables).toEqual([]);
    expect(result.missingColumns).toEqual(["week_items.section_id", "week_items.task_no"]);
  });

  it("collects missing columns across multiple tables", async () => {
    const result = await checkSchemaParity(
      fakeClient({
        missingColumns: { week_items: ["task_no"], sections: ["owner"] },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.missingColumns).toEqual(["week_items.task_no", "sections.owner"]);
  });

  it("skips column probes for a table that is missing entirely", async () => {
    const result = await checkSchemaParity(
      fakeClient({
        missingTables: ["sections"],
        missingColumns: { sections: ["owner"] },
      })
    );
    expect(result.missingTables).toEqual(["sections"]);
    expect(result.missingColumns).toEqual([]);
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
    const client = fakeClient({
      missingTables: ["sheet_registry"],
      missingColumns: { week_items: ["section_id"] },
      metaKeys: ["schema_version"],
    });
    await expect(runSchemaParityCheck(client)).rejects.toThrow(
      "Runway schema parity check FAILED — missing tables: sheet_registry; missing columns: week_items.section_id; missing _meta keys: feature_flags"
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
    expect(assertParityResult(CLEAN)).toContain("parity check passed");
  });

  it("throws with only the failing section when just tables are missing", () => {
    expect(() =>
      assertParityResult({
        ok: false,
        missingTables: ["sections"],
        missingColumns: [],
        missingMetaKeys: [],
      })
    ).toThrow("Runway schema parity check FAILED — missing tables: sections");
  });

  it("throws with only the failing section when just columns are missing", () => {
    expect(() =>
      assertParityResult({
        ok: false,
        missingTables: [],
        missingColumns: ["week_items.task_no"],
        missingMetaKeys: [],
      })
    ).toThrow("Runway schema parity check FAILED — missing columns: week_items.task_no");
  });

  it("throws with only the failing section when just _meta keys are missing", () => {
    expect(() =>
      assertParityResult({
        ok: false,
        missingTables: [],
        missingColumns: [],
        missingMetaKeys: ["feature_flags"],
      })
    ).toThrow("Runway schema parity check FAILED — missing _meta keys: feature_flags");
  });
});
