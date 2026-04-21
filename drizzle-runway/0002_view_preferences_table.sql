-- PR #86 Chunk 3 (rescued in Chunk 5, 2026-04-21): view_preferences table
--
-- Introduced with the In Flight toggle but the original push was never
-- captured as a `.sql` file. This migration reconciles the drift so a
-- fresh-DB replay via `drizzle-kit migrate` produces the full runtime
-- schema. Prod already has this table (see view-preferences.ts + the
-- "no such table" graceful fallback that covered the race window).
CREATE TABLE `view_preferences` (
	`scope` text PRIMARY KEY NOT NULL,
	`preferences` text NOT NULL,
	`updated_at` integer NOT NULL
);
