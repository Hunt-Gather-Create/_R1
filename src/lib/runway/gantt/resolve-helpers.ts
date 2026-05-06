/**
 * Pure entity-resolution helpers for the Runway Gantt pipeline.
 *
 * These are the testable, DB-free exports extracted from
 * scripts/lib/gantt/resolve-entity.ts. The async DB-coupled wrappers
 * (resolveProject, resolveClient) remain in scripts/lib/gantt/resolve-entity.ts
 * and import these helpers via a relative path back into src/.
 */

import { fuzzyMatch } from "@/lib/runway/operations-utils";
import type {
  ClientRow,
  ProjectRow,
  ResolvedSubject,
} from "./types";

// ── Pure helpers (testable without DB) ────────────────────

export function classifyProject(
  project: ProjectRow,
  childProjects: ProjectRow[],
): ResolvedSubject {
  const isWrapper =
    project.parentProjectId === null &&
    project.engagementType === "retainer" &&
    childProjects.length > 0;
  return isWrapper
    ? { kind: "wrapper", project, childProjects }
    : { kind: "l1", project };
}

function displayLabel(project: ProjectRow, clientsById: Map<string, ClientRow>): string {
  const clientName = clientsById.get(project.clientId)?.name ?? "?";
  // Include project id so an ambiguous user can copy-paste an exact match
  // back into `--project <id>`.
  return `${clientName}: ${project.name} (id=${project.id})`;
}

function parseNicknames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Build the qualified-match keys for a project. Used after the plain-name
 * fuzzy pass fails. Lets users type "hdl Website Build", "Convergix CDS",
 * or "Convergix / CDS Messaging" and reach the right project. Each
 * client-prefix is emitted in both " / " and bare-space forms so the user
 * doesn't have to think about the separator.
 */
function projectQualifiedKeys(
  project: ProjectRow,
  clientsById: Map<string, ClientRow>,
): string[] {
  const client = clientsById.get(project.clientId);
  if (!client) return [];
  const prefixes = [client.name, client.slug, ...parseNicknames(client.nicknames)];
  const keys: string[] = [];
  for (const prefix of prefixes) {
    keys.push(`${prefix} / ${project.name}`);
    keys.push(`${prefix} ${project.name}`);
  }
  return keys;
}

export function resolveProjectFromList(
  projectList: ProjectRow[],
  clientsById: Map<string, ClientRow>,
  input: string,
):
  | { ok: true; project: ProjectRow }
  | { ok: false; error: string; available?: string[] } {
  // 1. Exact id match
  const idHit = projectList.find((p) => p.id === input);
  if (idHit) return { ok: true, project: idHit };

  // 2. Fuzzy match on plain name
  const nameResult = fuzzyMatch(projectList, input, (p) => p.name);
  if (nameResult.kind === "match") return { ok: true, project: nameResult.value };

  // 3. Fuzzy match across all qualified keys (name, slug, nicknames). One
  //    project may contribute several entries; collapse duplicates by id.
  type Entry = { key: string; project: ProjectRow };
  const entries: Entry[] = projectList.flatMap((p) =>
    projectQualifiedKeys(p, clientsById).map((key) => ({ key, project: p })),
  );
  const qualifiedResult = fuzzyMatch(entries, input, (e) => e.key);

  if (qualifiedResult.kind === "match") {
    return { ok: true, project: qualifiedResult.value.project };
  }
  if (qualifiedResult.kind === "ambiguous") {
    const uniqueProjects = Array.from(
      new Map(qualifiedResult.options.map((e) => [e.project.id, e.project])).values(),
    );
    if (uniqueProjects.length === 1) {
      return { ok: true, project: uniqueProjects[0] };
    }
  }

  // 4. Ambiguous on either side → return options (deduped)
  if (nameResult.kind === "ambiguous" || qualifiedResult.kind === "ambiguous") {
    const options =
      nameResult.kind === "ambiguous"
        ? nameResult.options
        : qualifiedResult.kind === "ambiguous"
          ? Array.from(
              new Map(qualifiedResult.options.map((e) => [e.project.id, e.project])).values(),
            )
          : [];
    const display = options.map((p) => displayLabel(p, clientsById));
    return {
      ok: false,
      error: `Multiple projects match '${input}'. Use --project <id> or a more specific name. Candidates:`,
      available: display,
    };
  }

  return {
    ok: false,
    error: `Project '${input}' not found.`,
    available: projectList.map((p) => displayLabel(p, clientsById)),
  };
}

export function resolveClientFromList(
  clientList: ClientRow[],
  input: string,
):
  | { ok: true; client: ClientRow }
  | { ok: false; error: string; available?: string[] } {
  // 1. Exact id
  const idHit = clientList.find((c) => c.id === input);
  if (idHit) return { ok: true, client: idHit };
  // 2. Exact slug (case-insensitive)
  const slugHit = clientList.find((c) => c.slug.toLowerCase() === input.toLowerCase());
  if (slugHit) return { ok: true, client: slugHit };
  // 3. Fuzzy on name
  const result = fuzzyMatch(clientList, input, (c) => c.name);
  if (result.kind === "match") return { ok: true, client: result.value };
  if (result.kind === "ambiguous") {
    const options = result.options.map((c) => `${c.name} (slug=${c.slug})`);
    return {
      ok: false,
      error: `Multiple clients match '${input}'. Use --client <slug> or a more specific name. Candidates:`,
      available: options,
    };
  }
  return {
    ok: false,
    error: `Client '${input}' not found.`,
    available: clientList.map((c) => c.name),
  };
}
