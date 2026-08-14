import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { RunwayClientBundle } from "./runway-read";

export interface BundleDiff {
  weekItems: { id: string; before: unknown; after: unknown }[];
  projects: { id: string; before: unknown; after: unknown }[];
}

/**
 * Synchronously writes the client bundle to <dir>/<runId>-pre.json.
 * Called BEFORE any write attempt so a mid-apply crash still leaves the file on disk.
 * Returns the absolute path to the written file.
 */
export function writePreSnapshot(
  bundle: RunwayClientBundle,
  runId: string,
  dir: string,
): string {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${runId}-pre.json`);
  writeFileSync(filePath, JSON.stringify(bundle, null, 2));
  return filePath;
}

/**
 * Compares pre and post bundles by id, returning only the items whose
 * JSON.stringify differs (including items present in only one side).
 * Writes the diff to <dir>/<runId>-post-diff.json and returns it.
 * When pre and post are identical, both arrays are empty (file still writes).
 */
export function postVerifyDiff(
  pre: RunwayClientBundle,
  post: RunwayClientBundle,
  runId: string,
  dir: string,
): BundleDiff {
  const weekItems = diffById(pre.weekItems, post.weekItems);
  const projects = diffById(pre.projects, post.projects);

  const diff: BundleDiff = { weekItems, projects };

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${runId}-post-diff.json`), JSON.stringify(diff, null, 2));

  return diff;
}

function diffById<T extends { id: string }>(
  preItems: T[],
  postItems: T[],
): { id: string; before: unknown; after: unknown }[] {
  const preMap = new Map<string, T>(preItems.map((item) => [item.id, item]));
  const postMap = new Map<string, T>(postItems.map((item) => [item.id, item]));

  const allIds = new Set<string>([...preMap.keys(), ...postMap.keys()]);
  const changes: { id: string; before: unknown; after: unknown }[] = [];

  for (const id of allIds) {
    const before = preMap.get(id);
    const after = postMap.get(id);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({ id, before: before ?? null, after: after ?? null });
    }
  }

  return changes;
}
