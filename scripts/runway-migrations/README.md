# Runway migrations

Scripts in this directory write to (or audit) prod Turso. They run via `tsx` with `RUNWAY_DATABASE_URL` + `RUNWAY_AUTH_TOKEN` exported from `.env.local`.

## Diagnostics

- `pnpm runway:check-orphans` — scans `projects` for rows whose `parent_project_id` references a missing project. Read-only. Exits 0 when clean, 1 when orphans exist. Run after any operation that touches `parent_project_id` (wrapper creation, parent reassignment, project deletion).
