# DB Safety Tooling Research Brief
## Stack: Next.js + TypeScript + Drizzle ORM + Turso/libSQL + Vercel

_Research date: 2026-08-13. Target use case: Civilization Agency Runway dashboard._

---

## TL;DR

- **Never use `drizzle-kit push` in production.** Use `generate` + `migrate` with SQL files checked into git; push is for local dev only.
- **Turso supports instant DB branching** (`turso db create staging --from-db prod`): use this for a staging DB that mirrors prod schema + seed data.
- **Wrap every write in a typed "safe update" function** that accepts a dry-run flag, validates input with Zod, runs inside a transaction, and appends to an `audit_log` table.
- **SQLite triggers are the cleanest audit-trail primitive** for Turso; application-level audit inserts inside transactions are the safer cross-platform fallback for Drizzle.
- **The one big SQLite footgun:** all writes serialize through a single primary — Turso is not a fit for high-concurrency write workloads. Runway's write volume is fine; know this before the next project.

---

## Section 1: Safe DB Write Patterns (Drizzle specifics)

### Dry-run / plan-then-apply
Drizzle has no built-in "dry-run" mode for application writes. You implement it at the tool layer:
1. Build the change payload in TypeScript.
2. Run a validation pass (Zod or custom predicate) against the payload.
3. If `DRY_RUN=true`, log the proposed SQL (via `db.run().toSQL()`) and exit without committing.
4. Apply inside a transaction and roll back on any error.

`db.run().toSQL()` returns `{ sql, params }` without executing — use this to log the exact statement before committing. ([Drizzle migrations docs](https://orm.drizzle.team/docs/migrations))

### Transactional guards
```typescript
await db.transaction(async (tx) => {
  await tx.update(table).set(delta).where(eq(table.id, id));
  await tx.insert(auditLog).values({ ... });
});
```
SQLite transactions are serialized; the insert and the audit entry either both land or neither does.

### Optimistic locking / idempotency
Add a `version` integer column to mutable records. Every update increments it and filters on the expected version. Zero rows affected = stale write, reject and retry. This prevents lost-update races. ([Paul Serban, Drizzle Best Practices](https://blog.paulserban.eu/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/))

### Audit trail
Two options — pick one and stay consistent:

**Option A: Application-level audit table (recommended for Drizzle)**
```typescript
export const auditLog = sqliteTable('audit_log', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  tableName: text('table_name').notNull(),
  recordId:  text('record_id').notNull(),
  operation: text('operation').notNull(),   // INSERT | UPDATE | DELETE
  oldValues: text('old_values'),            // JSON string
  newValues: text('new_values'),            // JSON string
  changedAt: integer('changed_at', { mode: 'timestamp' }).notNull(),
  actor:     text('actor'),
});
```
Insert inside every write transaction. Drizzle gives you full type safety here.

**Option B: SQLite triggers (Turso-native)**
Turso CDC (`PRAGMA cdc = 1`) automatically logs every insert/update/delete to a CDC table with before/after values. Marked "unstable" in mid-2026; good for debugging, not a compliance store yet. ([Turso CDC announcement](https://turso.tech/blog/introducing-change-data-capture-in-turso-sqlite-rewrite))

For Runway: use Option A — it travels with Drizzle schema and survives driver changes.

### Expand-contract for structural changes
Never rename or drop a column in one migration. Pattern:
1. Add the new column (expand).
2. Dual-write to both old and new in application code.
3. Backfill old rows.
4. Flip reads to new column.
5. Drop the old column (contract, separate PR). ([Paul Serban, cited above](https://blog.paulserban.eu/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/))

---

## Section 2: Reusable / DRY Tooling Design

The core pattern: a thin **SafeWriter** class per project that wraps Drizzle's raw `db` object.

```typescript
// shared/lib/safe-writer.ts
interface WriteOpts<T> {
  dryRun?: boolean;
  actor?: string;
  validate?: (payload: T) => void;  // throws on invalid
}

class SafeWriter<T> {
  constructor(
    private db: LibSQLDatabase,
    private tableName: string
  ) {}

  async apply(fn: (tx: LibSQLDatabase) => Promise<T>, opts?: WriteOpts<T>) {
    if (opts?.dryRun) { console.log('[DRY-RUN]', this.tableName); return; }
    return this.db.transaction(async (tx) => {
      const result = await fn(tx);
      await tx.insert(auditLog).values({
        tableName: this.tableName,
        operation: 'WRITE',
        actor: opts?.actor ?? 'system',
        changedAt: new Date(),
      });
      return result;
    });
  }
}
```

Key design rules for a shared library:
- Accept an `opts.validate` callback so each project injects its own business rules.
- Keep the Drizzle `db` instance as a constructor param — swap it for a staging or test DB without touching the writer code.
- Export a typed `createSafeWriter(db, tableName)` factory function so projects don't import the class directly.
- Never put project-specific column names inside the shared code. ([repository pattern reference](https://dev.to/fyapy/repository-pattern-with-typescript-and-nodejs-25da))

OPEN QUESTION: Whether to publish this as a private npm workspace package (`@civ/db-safety`) or keep it as a shared module inside the R1 monorepo. Decide when a second project needs it.

---

## Section 3: Staging vs Prod on Turso/libSQL

### Create a staging DB from prod
```bash
turso db create runway-staging --from-db runway-prod
```
This is a metadata-only copy operation — instant. Both databases are fully independent after branching. ([Codebrand Turso guide 2026](https://www.codebrand.us/blog/turso-database-complete-guide-2026/))

### Three-env setup
```
TURSO_DATABASE_URL=libsql://runway-prod-...turso.io   # .env.production
TURSO_DATABASE_URL=libsql://runway-staging-...turso.io # .env.staging
TURSO_DATABASE_URL=file:local.db                       # .env.local
```
In `drizzle.config.ts`, read the env var — the same config file serves all three environments. Vercel environment variables control which URL each deploy uses.

### Promoting schema staging → prod
```bash
# 1. Generate migration against staging (verifies it applies cleanly)
TURSO_DATABASE_URL=$STAGING_URL npx drizzle-kit migrate

# 2. Review the SQL files in /drizzle
# 3. Apply the same checked-in migration file to prod
TURSO_DATABASE_URL=$PROD_URL npx drizzle-kit migrate
```
The migration file is the promotion artifact — same file, different URL. Never run `push` against prod.

### Replication lag warning
Turso propagates writes from the primary to edge replicas asynchronously. If you write and immediately read from an edge replica, you may see stale data. For Runway (low write volume, admin-driven mutations): not a practical issue. For future high-frequency workloads: route writes and immediate post-write reads to the primary URL explicitly.

---

## Section 4: Migration Safety with Drizzle Kit

| Command | Use case | Production-safe? |
|---|---|---|
| `drizzle-kit generate` | Creates SQL migration files | Yes — review before applying |
| `drizzle-kit migrate` | Applies checked-in SQL files | Yes — files are version-controlled |
| `drizzle-kit push` | Directly mutates DB schema | No — destructive, no file trail |
| `drizzle-kit studio` | Read-only browser UI | Yes |

### Destructive migration guard
Drizzle does NOT block `DROP COLUMN` or `DROP TABLE` by default. It will warn during `push` but will proceed on confirmation. With `generate`, you see the SQL before it runs — the human review step is the guard.

**Add this CI check:** after `generate`, grep the output SQL for `DROP` statements and fail the CI job if any appear without a matching `[SAFE-DROP]` comment added by the engineer.

```bash
# In CI
if grep -i "^DROP" drizzle/*.sql | grep -v "SAFE-DROP"; then
  echo "Destructive migration detected — manual review required"; exit 1
fi
```

### Pre-flight schema parity
Before applying to prod, run `drizzle-kit check` (verifies no drift between schema file and DB state) then `drizzle-kit migrate` with the staging URL first. If staging apply succeeds, apply the identical file to prod.

Drizzle tracks applied migrations in a `__drizzle_migrations` table by content hash. Never edit a migration file after it has been applied — the hash will no longer match and future runs will skip or fail. ([Drizzle docs](https://orm.drizzle.team/docs/migrations); [Dev Encyclopedia](https://devencyclopedia.com/blog/drizzle-orm-migrations-drizzle-kit))

---

## Section 5: What NOT To Do (Footguns)

1. **`drizzle-kit push` against prod.** Applies DDL directly, no file, no review, no rollback. One `DROP` warning you click past and your data is gone.

2. **Having both `better-sqlite3` and `@libsql/client` installed.** Drizzle's auto-detect will choose libsql even when you want local SQLite, treating a file path as a URL and failing silently. Keep one driver per project. ([GitHub issue #3421](https://github.com/drizzle-team/drizzle-orm/issues/3421))

3. **Check constraints + `push` on SQLite.** A known bug creates duplicate indexes and crashes the push with "index already exists." Use `generate` + `migrate` if your schema has check constraints. ([GitHub issue #4574](https://github.com/drizzle-team/drizzle-orm/issues/4574))

4. **Editing a migration file after it has been applied.** Drizzle hashes migration files. Edit an applied file and the hash check will mismatch on the next `migrate` run. Regenerate instead.

5. **High write concurrency on SQLite/libSQL.** SQLite serializes concurrent writers. Thousands of writes per second will bottleneck at the primary. Runway is fine; a multi-tenant SaaS with heavy concurrent writes is not. Plan for PostgreSQL there. ([Codebrand Turso pitfalls](https://www.codebrand.us/blog/turso-database-complete-guide-2026/))

6. **Embedded replica cold-starts on serverless.** The first `db.sync()` pulls the entire DB, generating billable read charges on every cold container. Sync on interval or after known writes, not on every request.

---

## Proposed Reusable Tool Shape

This is an interface sketch, not production code. CC builds the actual implementation.

```typescript
// Shared interface — lives in shared/lib/db-safe-writer.ts
export interface SafeWriteOptions {
  dryRun: boolean;
  actor: string;
  batchId: string;
}

export interface SafeWriteResult<T> {
  applied: boolean;
  rowsAffected: number;
  payload?: T;
  auditId?: number;
}

// Per-project factory
export function createSafeWriter(db: LibSQLDatabase, tableName: string) {
  return {
    async write<T>(
      fn: (tx: LibSQLDatabase) => Promise<T>,
      validate: (payload: unknown) => asserts payload is T,
      opts: SafeWriteOptions
    ): Promise<SafeWriteResult<T>> { ... }
  };
}
```

Project-specific usage:
```typescript
const writer = createSafeWriter(db, 'work_items');
await writer.write(
  (tx) => tx.update(workItems).set({ status: 'complete' }).where(eq(workItems.id, id)),
  validateWorkItemUpdate,     // project-owned Zod assert
  { dryRun: false, actor: 'slack-bot', batchId: 'batch-2026-08' }
);
```

---

## Sources

- [Drizzle ORM Migrations docs](https://orm.drizzle.team/docs/migrations)
- [Get Started with Drizzle and Turso Cloud](https://orm.drizzle.team/docs/get-started/turso-new)
- [Drizzle ORM Best Practices — Paul Serban](https://blog.paulserban.eu/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/)
- [Turso Database 2026: Edge SQLite Setup, Costs & Pitfalls](https://www.codebrand.us/blog/turso-database-complete-guide-2026/)
- [Introducing Change Data Capture for SQLite in Turso](https://turso.tech/blog/introducing-change-data-capture-in-turso-sqlite-rewrite)
- [Tracking SQLite table history using a JSON audit log — Simon Willison](https://til.simonwillison.net/sqlite/json-audit-log)
- [Drizzle Kit push fails with both better-sqlite3 and libsql (GH #3421)](https://github.com/drizzle-team/drizzle-orm/issues/3421)
- [Drizzle Kit push check constraints / duplicate index bug (GH #4574)](https://github.com/drizzle-team/drizzle-orm/issues/4574)
- [Drizzle ORM Migrations: A Practical Guide — Dev Encyclopedia](https://devencyclopedia.com/blog/drizzle-orm-migrations-drizzle-kit)
- [Repository Pattern with TypeScript and Node.js — DEV Community](https://dev.to/fyapy/repository-pattern-with-typescript-and-nodejs-25da)
- [What is Turso? — Turso](https://turso.tech/what-is-turso)
