/**
 * Ready-to-apply operation payloads (Q1.14 (a)) — self-contained, landmines
 * pre-applied. DI-TP or Phase 1b consume these AS-IS; no downstream
 * re-encoding of notes caps, enum values, disambiguation, or date ordering.
 *
 * Phase 1a emits payloads. It never executes them.
 */
import { WEEK_ITEM_STATUSES } from "../../src/lib/runway/week-item-statuses";
import type { DiffResult, SyncPayload } from "./types";

export function buildPayloads(diff: DiffResult, runId: string): SyncPayload[] {
  const payloads: SyncPayload[] = [];
  const updatedBy = `sheet-sync:${runId}`;
  let order = 0;
  const sheetId = diff.config.sheetId;

  if (!diff.l1.resolved && diff.counts["leaf-tasks"] > 0) {
    if (diff.l1.reviewCandidate) {
      // A week-item-carry candidate exists below match confidence: this
      // might be an engagement tracked as a WI under an existing L1, not a
      // missing L1 (standing limit, _R1#153). Route to review naming the
      // candidate instead of proposing a create the tool cannot vouch for.
      const rc = diff.l1.reviewCandidate;
      payloads.push({
        op: "flag-for-review",
        params: {
          candidateWeekItemId: rc.weekItemId,
          candidateWeekItemTitle: rc.weekItemTitle,
          candidateProjectId: rc.projectId,
          candidateProjectName: rc.projectName,
          score: rc.score,
        },
        source: { sheetId, rowNumber: 0, taskNo: null },
        applyOrder: order++,
        requiresReview: true,
        preflight: { statusValid: true, categoryValid: true },
        reason: `week-item-carry candidate "${rc.weekItemTitle}" under "${rc.projectName}" (score ${rc.score}): below confidence to auto-resolve, no L1 create proposed`,
      });
    } else {
      // Proposed L1 create when nothing resolved: review-gated, never automatic.
      payloads.push({
        op: "addProject",
        params: {
          clientSlug: diff.config.clientSlug,
          name: diff.config.label,
          notes: `${diff.config.engagementCode}: synced from Sheet ${sheetId}`,
          updatedBy,
        },
        source: { sheetId, rowNumber: 0, taskNo: null },
        applyOrder: order++,
        requiresReview: true,
        preflight: { statusValid: true, categoryValid: true },
        reason: "no Runway L1 matched this engagement, no resolver fired",
      });
    }
  }

  for (const rd of diff.rowDiffs) {
    if (!rd.leaf) continue;
    const leaf = rd.leaf;
    const source = { sheetId, rowNumber: leaf.rowNumber, taskNo: leaf.taskNo };

    if (rd.disposition === "missing-in-runway") {
      const statusValid = (WEEK_ITEM_STATUSES as readonly string[]).includes(
        leaf.derivedStatus
      );
      // category is always null on create (_R1#160, TP ruling 2026-09-22):
      // null is always a valid category, so this is not a WEEK_ITEM_CATEGORIES
      // membership check on leaf.category, the tool never writes that
      // derived value.
      const categoryValid = true;
      // createWeekItem rejects when no weekOf is derivable — unparseable
      // sheet dates make this payload unapplyable as-is, so review-gate it.
      const datesMissing = leaf.weekOf === null;
      payloads.push({
        op: "createWeekItem",
        params: {
          clientSlug: diff.config.clientSlug,
          projectName: diff.l1.projectName ?? diff.config.label,
          title: leaf.resolvedTitle,
          startDate: leaf.startDate ?? undefined,
          endDate: leaf.endDate ?? undefined,
          weekOf: leaf.weekOf ?? undefined,
          status: leaf.derivedStatus,
          // Always null (_R1#160, TP ruling 2026-09-22): matches what every
          // hand-created card in prod holds. leaf.category is Q1.12's
          // keyword-derived value; the sheet has no category column and
          // never authorizes a create-time value.
          category: null,
          notes: leaf.notes,
          updatedBy,
        },
        source,
        applyOrder: order++,
        requiresReview: rd.collision === true || datesMissing,
        preflight: {
          notesLength: leaf.notes.length,
          notesTruncated: leaf.notesTruncated,
          titleDisambiguated: leaf.resolvedTitle !== leaf.title,
          datesMissing,
          statusValid,
          categoryValid,
        },
        advisory: { sortOrder: leaf.sortOrder },
        reason: rd.collision
          ? `mid-week collision — ${rd.note ?? "flagged"}`
          : datesMissing
            ? "sheet leaf task has no Runway counterpart (dates unparseable — resolve before apply)"
            : "sheet leaf task has no Runway counterpart",
      });
      continue;
    }

    if (rd.disposition === "mismatched-field" && rd.deltas) {
      for (const delta of rd.deltas) {
        if (delta.action === "write") {
          payloads.push({
            op: "updateWeekItemField",
            // EXACTLY UpdateWeekItemFieldParams — the helper looks the row
            // up by (weekOf, weekItemTitle) against the RUNWAY row, so the
            // matched WI's weekOf + title are used, never the sheet's.
            params: {
              weekOf: rd.weekItemWeekOf,
              weekItemTitle: rd.weekItemTitle,
              field: delta.field,
              newValue: delta.sheet,
              updatedBy,
            },
            source,
            // Delta order already encodes FORWARD endDate-first (§2.8).
            applyOrder: order++,
            requiresReview: rd.weekItemWeekOf == null,
            preflight: { statusValid: true, categoryValid: true },
            advisory: {
              weekItemId: rd.weekItemId,
              clientSlug: diff.config.clientSlug,
            },
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
                ? `Runway status "${delta.runway}" is human-set (§2.4), sync never overwrites`
                : delta.field === "category"
                  ? `Runway category "${delta.runway}" already set, the sheet has no category column and never authorizes a value (_R1#160)`
                  : delta.field === "title"
                    ? `title drift "${delta.runway}" → "${delta.sheet}", matched by fuzzy title alone, correcting the match key would fight the matcher (_R1#160)`
                    : delta.runway === "canceled"
                      ? `Runway status "canceled" vs sheet "${delta.sheet}", terminal-state divergence, editorial call for AM (§2.4)`
                      : `completed↔unchecked divergence, editorial call for AM (§2.4)`,
          });
        }
      }
    }
  }

  return payloads;
}
