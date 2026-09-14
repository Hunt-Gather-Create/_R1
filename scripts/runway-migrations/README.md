# Runway migrations

Scripts in this directory write to (or audit) prod Turso. They run via `tsx` with `RUNWAY_DATABASE_URL` + `RUNWAY_AUTH_TOKEN` exported from `.env.local`.

## Diagnostics

- `pnpm runway:check-orphans` — scans `projects` for rows whose `parent_project_id` references a missing project. Read-only. Exits 0 when clean, 1 when orphans exist. Run after any operation that touches `parent_project_id` (wrapper creation, parent reassignment, project deletion).

## DI-TP working scripts

A DI-TP one-off migration or revert that should never be tracked in runway gets a `.di.ts` filename suffix, for example `kathy-bp-cgx-2026-09-07.di.ts`. `.gitignore` matches `scripts/runway-migrations/*.di.ts` so every DI-TP working script stays untracked regardless of when it was written, with no date to expire. Give a script this suffix the moment it is written, not after. Tracked migrations in this directory never carry `.di.ts`; that suffix is what keeps `git status` able to tell a DI-TP working file apart from the repo's own migration convention (_R1#168).
