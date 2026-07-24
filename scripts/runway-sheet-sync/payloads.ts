/**
 * Ready-to-apply operation payloads (Q1.14 (a)) — self-contained, landmines
 * pre-applied. DI-TP or Phase 1b consume these AS-IS; no downstream
 * re-encoding of notes caps, enum values, disambiguation, or date ordering.
 *
 * Phase 1a emits payloads. It never executes them.
 */
import { WEEK_ITEM_CATEGORIES } from "../../src/lib/runway/week-item-categories";
import { WEEK_ITEM_STATUSES } from "../../src/lib/runway/week-item-statuses";
import type { DiffResult, SyncPayload } from "./types";

export function buildPayloads(diff: DiffResult, runId: string): SyncPayload[] {
  const payloads: SyncPayload[] = [];
  const updatedBy = `sheet-sync:${runId}`;
  let order = 0;
  const sheetId = diff.config.sheetId;

  // Proposed L1 create when nothing resolved — review-gated, never automatic.
  if (!diff.l1.resolved && diff.counts["leaf-tasks"] > 0) {
    payloads.push({
      op: "addProject",
      params: {
        clientSlug: diff.config.clientSlug,
        name: diff.config.label,
        notes: `${diff.config.engagementCode} — synced from Sheet ${sheetId}`,
        updatedBy,
      },
      source: { sheetId, rowNumber: 0, taskNo: null },
      applyOrder: order++,
      requiresReview: true,
      preflight: { statusValid: true, categoryValid: true },
      reason: "no Runway L1 matched this engagement (code + fuzzy both missed)",
    });
  }

  for (const rd of diff.rowDiffs) {
    if (!rd.leaf) continue;
    const leaf = rd.leaf;
    const source = { sheetId, rowNumber: leaf.rowNumber, taskNo: leaf.taskNo };

    if (rd.disposition === "missing-in-runway") {
      const statusValid = (WEEK_ITEM_STATUSES as readonly string[]).includes(leaf.derivedStatus);
      const categoryValid = (WEEK_ITEM_CATEGORIES as readonly string[]).includes(leaf.category);
      payloads.push({
        op: "createWeekItem",
        params: {
          clientSlug: diff.config.clientSlug,
          projectName: diff.l1.projectName ?? diff.config.label,
          title: leaf.resolvedTitle,
          startDate: leaf.startDate,
          endDate: leaf.endDate,
          weekOf: leaf.weekOf,
          status: leaf.derivedStatus,
          category: leaf.category,
          notes: leaf.notes,
          sortOrder: leaf.sortOrder,
          updatedBy,
        },
        source,
        applyOrder: order++,
        requiresReview: rd.collision === true,
        preflight: {
          notesLength: leaf.notes.length,
          notesTruncated: leaf.notesTruncated,
          titleDisambiguated: leaf.resolvedTitle !== leaf.title,
          statusValid,
          categoryValid,
        },
        reason: rd.collision
          ? `mid-week collision — ${rd.note ?? "flagged"}`
          : "sheet leaf task has no Runway counterpart",
      });
      continue;
    }

    if (rd.disposition === "mismatched-field" && rd.deltas) {
      for (const delta of rd.deltas) {
        if (delta.action === "write") {
          payloads.push({
            op: "updateWeekItemField",
            params: {
              clientSlug: diff.config.clientSlug,
              weekItemId: rd.weekItemId,
              title: rd.weekItemTitle,
              weekOf: rd.leaf.weekOf,
              field: delta.field,
              newValue: delta.sheet,
              updatedBy,
            },
            source,
            // Delta order already encodes FORWARD endDate-first (§2.8).
            applyOrder: order++,
            requiresReview: false,
            preflight: { statusValid: true, categoryValid: true },
            reason: `field drift: ${delta.field} runway=${delta.runway ?? "null"} sheet=${delta.sheet ?? "null"}`,
          });
        } else {
          payloads.push({
            op: "flag-for-review",
            params: {
              weekItemId: rd.weekItemId,
              field: delta.field,
              sheetValue: delta.sheet,
              runwayValue: delta.runway,
              policy: delta.action,
            },
            source,
            applyOrder: order++,
            requiresReview: true,
            preflight: { statusValid: true, categoryValid: true },
            reason:
              delta.action === "protected-no-write"
                ? `Runway status "${delta.runway}" is human-set (§2.4) — sync never overwrites`
                : `completed↔unchecked divergence — editorial call for AM (§2.4)`,
          });
        }
      }
    }
  }

  return payloads;
}
