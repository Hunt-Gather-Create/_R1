# Runway migrations

Scripts in this directory write to (or audit) prod Turso. They run via `tsx` with `RUNWAY_DATABASE_URL` + `RUNWAY_AUTH_TOKEN` exported from `.env.local`.

## Diagnostics

- `pnpm runway:check-orphans` — scans `projects` for rows whose `parent_project_id` references a missing project. Read-only. Exits 0 when clean, 1 when orphans exist. Run after any operation that touches `parent_project_id` (wrapper creation, parent reassignment, project deletion).

## PR 88 archive

Scripts retained as historical record of the `projects.target` column drop:

- `precheck-target-backup.ts` — read-only snapshot of every project's `target` value before migration.
- `apply-target-to-notes-raw.ts` — appends `[Legacy target: ...]` blocks into `notes`.
- `apply-pr88-schema-raw.ts` — raw SQL `ALTER TABLE` to drop `projects.target` and add `projects.parent_project_id`.

Backup of pre-migration `target` values: `backups/target-backup-2026-04-21.json`.
