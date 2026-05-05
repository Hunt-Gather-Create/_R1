/**
 * `view_submission` validation tier — Wave 9 / Builder 9.
 *
 * Pure function that validates a Slack `view_submission` payload against the
 * proposal it stages from. Reuses Wave 0b validators for cross-cutting rules
 * (status/category compatibility, role-tag-on-resources, date-order,
 * past-date soft-warn, notes maxLength) and adds modal-specific concerns:
 *
 *   - Empty-string normalization at the boundary (datepicker / plain-text
 *     inputs that come back as "" become null).
 *   - Required-field check (per is_retainer state for Project; per modal kind
 *     for Task / Team Member).
 *   - Parent-must-be-retainer (Project, non-retainer mode).
 *   - Title-collision soft-warn (Sørensen-Dice >= 0.85 against same client /
 *     project / global teamMembers).
 *   - Wrapper-vs-child date-extension soft-warn (Project edit when child of a
 *     retainer wrapper, child date exceeds wrapper's contract range).
 *   - Lazy reference resolution for tasks via `pending_project_name → projectId`
 *     when the proposal carries a hint and the user submitted with no parent.
 *   - Edit-flow target-still-exists check (target deleted between modal-open
 *     and submit).
 *   - Edit-flow changed-field diff (compute keys whose value differs from
 *     `currentValues`; only validate those; reject if no fields changed).
 *
 * Spec: docs/tmp/slack-modal-pre-plan.md (v7) — §"Wave 9", §C5 (edit-flow
 * diff), §A3 (lazy resolution), copy strings in `./copy.ts`.
 *
 * Block IDs match the live modal builders in `./task.ts`, `./project.ts`,
 * `./team-member.ts`. The fixtures in `tests/fixtures/slack/view-submission-*`
 * predate the final modal builders and may use older block IDs — the modal
 * builders are the source of truth here.
 */

import { eq } from "drizzle-orm";
import {
  projects,
  weekItems,
  teamMembers,
  type botModalProposals,
} from "@/lib/db/runway-schema";
import {
  normalizeEmptyToNull,
  validateStatusCategoryCompatibility,
  validateRoleTagOnResources,
  validateStartEndDateOrder,
  validatePastDateNonTerminal,
  validateNotesMaxLength,
} from "@/lib/runway/operations-utils";
import { fuzzyMatchCandidates } from "@/lib/runway/fuzzy-match";
import { PARENT_PROJECT_NOT_FOUND } from "./copy";
import type { getRunwayDb } from "@/lib/db/runway";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of `botModalProposals.$inferSelect` we actually consume. Defined as
 * a structural type so test fixtures can pass minimal shapes without having to
 * synthesize every column on the row.
 */
export type ProposalForValidation = Pick<
  typeof botModalProposals.$inferSelect,
  | "id"
  | "toolName"
  | "kind"
  | "args"
  | "targetEntityId"
  | "targetEntityType"
  | "pendingProjectName"
  | "resolvedProjectId"
  | "status"
>;

export interface ValidateModalSubmissionParams {
  /** Proposal row from `bot_modal_proposals` (already loaded by the caller). */
  proposal: ProposalForValidation;
  /** `view.state.values` from the Slack `view_submission` payload. */
  stateValues: Record<string, Record<string, unknown>>;
  /** Drizzle DB handle — used for lookups. Read-only. */
  db: ReturnType<typeof getRunwayDb>;
}

/**
 * Slack `view_submission` `response_action: "errors"` shape — keys are
 * block_ids, values are inline error messages.
 */
export type SlackErrorsByBlockId = Record<string, string>;

export type ValidationResult =
  | {
      ok: true;
      /** Normalized field values, ready for the operations-layer write. */
      normalized: Record<string, unknown>;
      /**
       * For edit-flow only: keys in `normalized` whose value differs from the
       * target entity's current value. The caller (Wave 10) routes only these
       * through `updateProjectField` / `updateWeekItemField` etc.
       */
      changedFields?: string[];
      /**
       * Soft warnings (e.g. blocked + active, past-date + non-terminal,
       * title-collision, wrapper-date-extension). Surface to the user but do
       * not block submit.
       */
      softWarnings?: string[];
    }
  | { ok: false; errors: SlackErrorsByBlockId };

// ---------------------------------------------------------------------------
// Modal kind discriminator — derived from proposal.toolName.
// ---------------------------------------------------------------------------

type ModalKind = "task" | "project" | "team_member";

function modalKindFromToolName(toolName: string): ModalKind {
  if (toolName.includes("project")) return "project";
  if (toolName.includes("team_member")) return "team_member";
  return "task";
}

// ---------------------------------------------------------------------------
// state.values readers — Slack ships values keyed by block_id then action_id.
// Each element has its own payload shape (plain_text_input, datepicker,
// static_select, external_select, radio_buttons, checkboxes).
// ---------------------------------------------------------------------------

interface SelectElement {
  selected_option?: { value?: unknown };
  selected_options?: Array<{ value?: unknown }>;
}

interface PlainTextElement {
  value?: unknown;
}

interface DateElement {
  selected_date?: unknown;
}

function readPlainText(
  values: Record<string, Record<string, unknown>>,
  blockId: string,
  actionId: string,
): string | null {
  const el = values[blockId]?.[actionId] as PlainTextElement | undefined;
  if (!el) return null;
  if (typeof el.value === "string") return normalizeEmptyToNull(el.value);
  return null;
}

function readSelect(
  values: Record<string, Record<string, unknown>>,
  blockId: string,
  actionId: string,
): string | null {
  const el = values[blockId]?.[actionId] as SelectElement | undefined;
  if (!el) return null;
  if (typeof el.selected_option?.value === "string") {
    return normalizeEmptyToNull(el.selected_option.value);
  }
  const first = el.selected_options?.[0]?.value;
  if (typeof first === "string") return normalizeEmptyToNull(first);
  return null;
}

function readDate(
  values: Record<string, Record<string, unknown>>,
  blockId: string,
  actionId: string,
): string | null {
  const el = values[blockId]?.[actionId] as DateElement | undefined;
  if (!el) return null;
  if (typeof el.selected_date === "string") {
    return normalizeEmptyToNull(el.selected_date);
  }
  return null;
}

function readCheckbox(
  values: Record<string, Record<string, unknown>>,
  blockId: string,
  actionId: string,
  flagValue: string,
): boolean {
  const el = values[blockId]?.[actionId] as
    | { selected_options?: Array<{ value?: unknown }> }
    | undefined;
  if (!el) return false;
  return (el.selected_options ?? []).some((o) => o.value === flagValue);
}

// ---------------------------------------------------------------------------
// Resources helpers — collect rows 0..9 into a "Role: Name" array used by the
// role-tag validator and stored as a comma-joined string downstream.
// ---------------------------------------------------------------------------

const RESOURCES_MAX_ROWS = 10;

interface ResourceRow {
  /** Role abbreviation or null when the user left the role select empty. */
  role: string | null;
  /** Person name or null when the user left the name select empty. */
  name: string | null;
  /** Block IDs the row came from — used to key validator errors. */
  roleBlockId: string;
  nameBlockId: string;
}

function collectResourceRows(
  values: Record<string, Record<string, unknown>>,
): ResourceRow[] {
  const rows: ResourceRow[] = [];
  for (let i = 0; i < RESOURCES_MAX_ROWS; i++) {
    const roleBlockId = `resources_block_${i}`;
    const nameBlockId = `resources_name_block_${i}`;
    const role = readSelect(values, roleBlockId, `resources_role_${i}`);
    const name = readSelect(values, nameBlockId, `resources_name_${i}`);
    if (role || name) {
      rows.push({ role, name, roleBlockId, nameBlockId });
    }
  }
  return rows;
}

function resourceRowsToString(rows: ResourceRow[]): string {
  return rows
    .filter((r) => r.role || r.name)
    .map((r) => (r.role && r.name ? `${r.role}: ${r.name}` : (r.name ?? r.role ?? "")))
    .join(", ");
}

// ---------------------------------------------------------------------------
// Title-collision soft-warn — Sørensen-Dice >= 0.85 against existing entries.
// ---------------------------------------------------------------------------

const TITLE_COLLISION_THRESHOLD = 0.85;

function softWarnTitleCollision(
  matches: Array<{ name: string }>,
  candidate: string,
  kind: "project" | "task" | "team member",
): string | null {
  if (matches.length === 0) return null;
  const names = matches.map((m) => m.name).slice(0, 3).join(", ");
  return `A ${kind} with a similar name already exists ('${candidate}' matched: ${names}). Confirm this is intended.`;
}

// ---------------------------------------------------------------------------
// Per-modal field extraction — into a normalized object keyed by canonical
// field names (matches operations-layer column keys where possible).
// ---------------------------------------------------------------------------

interface ExtractedTaskFields {
  clientId: string | null;
  parentProjectId: string | null;
  title: string | null;
  category: string | null;
  dateType: string | null;
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  owner: string | null;
  resources: string | null;
  resourceRows: ResourceRow[];
  notes: string | null;
}

function extractTaskFields(
  values: Record<string, Record<string, unknown>>,
): ExtractedTaskFields {
  const dateRaw = readSelect(values, "date_type_block", "date_type_radio");
  const date = readDate(values, "date_block", "date_picker");
  const startDate = readDate(values, "start_date_block", "start_date_picker");
  const endDate = readDate(values, "end_date_block", "end_date_picker");

  // dateType inference: the radio's reading from state.values is unreliable
  // across views.update rebuilds. Slack returns either nothing OR the prior
  // initial_option value (e.g. "single") even after the user toggled to
  // Range and the rebuild swapped the rendered pickers. The actual filled
  // date fields are the authoritative signal: if the user populated start
  // or end, they want Range mode; if they populated `date`, they want
  // Single. Fall back to the radio reading only when no date fields are
  // populated (so the required-field check below can still fire correctly).
  let dateType: string | null;
  if (startDate || endDate) {
    dateType = "range";
  } else if (date) {
    dateType = "single";
  } else {
    dateType = dateRaw;
  }

  const resourceRows = collectResourceRows(values);
  return {
    clientId: readSelect(values, "client_block", "client_select"),
    parentProjectId: readSelect(
      values,
      "parent_project_block",
      "parent_project_select",
    ),
    title: readPlainText(values, "title_block", "title_input"),
    category: readSelect(values, "category_block", "category_select"),
    dateType,
    date,
    startDate,
    endDate,
    owner: readSelect(values, "owner_block", "owner_select"),
    resources: resourceRowsToString(resourceRows),
    resourceRows,
    notes: readPlainText(values, "notes_block", "notes_input"),
  };
}

interface ExtractedProjectFields {
  clientId: string | null;
  isRetainer: boolean;
  name: string | null;
  engagementType: string | null;
  parentProjectId: string | null;
  status: string | null;
  category: string | null;
  owner: string | null;
  resources: string | null;
  resourceRows: ResourceRow[];
  startDate: string | null;
  endDate: string | null;
  dueDate: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  notes: string | null;
}

function extractProjectFields(
  values: Record<string, Record<string, unknown>>,
): ExtractedProjectFields {
  const isRetainer = readCheckbox(
    values,
    "is_retainer_block",
    "is_retainer_checkbox",
    "is_retainer",
  );
  const resourceRows = collectResourceRows(values);
  return {
    clientId: readSelect(values, "client_block", "client_select"),
    isRetainer,
    name: readPlainText(values, "project_name_block", "project_name_input"),
    engagementType: isRetainer
      ? "retainer"
      : readSelect(values, "engagement_type_block", "engagement_type_radio"),
    parentProjectId: isRetainer
      ? null
      : readSelect(values, "parent_retainer_block", "parent_retainer_picker"),
    status: readSelect(values, "status_block", "status_select"),
    category: readSelect(values, "category_block", "category_select"),
    owner: readSelect(values, "owner_block", "owner_select"),
    resources: resourceRowsToString(resourceRows),
    resourceRows,
    startDate: readDate(values, "start_date_block", "start_date_picker"),
    endDate: readDate(values, "end_date_block", "end_date_picker"),
    dueDate: readDate(values, "due_date_block", "due_date_picker"),
    contractStart: readDate(values, "contract_start_block", "contract_start_picker"),
    contractEnd: readDate(values, "contract_end_block", "contract_end_picker"),
    notes: readPlainText(values, "notes_block", "notes_input"),
  };
}

interface ExtractedTeamMemberFields {
  clientId: string | null;
  fullName: string | null;
  roleCategory: string | null;
  email: string | null;
}

function extractTeamMemberFields(
  values: Record<string, Record<string, unknown>>,
): ExtractedTeamMemberFields {
  return {
    clientId: readSelect(values, "client_block", "client_select"),
    fullName: readPlainText(values, "name_block", "name_input"),
    roleCategory: readSelect(
      values,
      "role_category_block",
      "role_category_select",
    ),
    email: readPlainText(values, "email_block", "email_input"),
  };
}

// ---------------------------------------------------------------------------
// DB lookups — read-only.
// ---------------------------------------------------------------------------

type DbHandle = ValidateModalSubmissionParams["db"];

async function loadProjectById(
  db: DbHandle,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

async function loadAllProjects(
  db: DbHandle,
): Promise<Array<Record<string, unknown>>> {
  return (await db.select().from(projects)) as Array<Record<string, unknown>>;
}

async function loadAllWeekItems(
  db: DbHandle,
): Promise<Array<Record<string, unknown>>> {
  return (await db.select().from(weekItems)) as Array<Record<string, unknown>>;
}

async function loadAllTeamMembers(
  db: DbHandle,
): Promise<Array<Record<string, unknown>>> {
  return (await db.select().from(teamMembers)) as Array<Record<string, unknown>>;
}

async function loadTargetEntity(
  db: DbHandle,
  type: string | null,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (type === "project") return loadProjectById(db, id);
  if (type === "week_item") {
    const rows = await db
      .select()
      .from(weekItems)
      .where(eq(weekItems.id, id))
      .limit(1);
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  }
  if (type === "team_member") {
    const rows = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.id, id))
      .limit(1);
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: map an extracted-fields object to canonical write-layer keys for
// the diff comparison + downstream payload shape.
// ---------------------------------------------------------------------------

function projectExtractToCanonical(
  fields: ExtractedProjectFields,
): Record<string, unknown> {
  return {
    clientId: fields.clientId,
    name: fields.name,
    engagementType: fields.engagementType,
    parentProjectId: fields.parentProjectId,
    status: fields.status,
    category: fields.category,
    owner: fields.owner,
    resources: fields.resources || null,
    startDate: fields.startDate,
    endDate: fields.endDate,
    dueDate: fields.dueDate,
    contractStart: fields.contractStart,
    contractEnd: fields.contractEnd,
    notes: fields.notes,
  };
}

function taskExtractToCanonical(
  fields: ExtractedTaskFields,
): Record<string, unknown> {
  // Single mode mirrors the picked date to BOTH startDate AND endDate so
  // every task row carries both columns populated (data integrity rule —
  // never leave endDate null when Single day was selected). Range mode
  // keeps the two pickers separate.
  let startDate = fields.startDate;
  let endDate = fields.endDate;
  if (fields.dateType !== "range" && fields.date) {
    startDate = fields.date;
    endDate = fields.date;
  }
  return {
    clientId: fields.clientId,
    projectId: fields.parentProjectId,
    title: fields.title,
    category: fields.category,
    date: fields.date,
    startDate,
    endDate,
    owner: fields.owner,
    resources: fields.resources || null,
    notes: fields.notes,
  };
}

function teamMemberExtractToCanonical(
  fields: ExtractedTeamMemberFields,
): Record<string, unknown> {
  return {
    clientId: fields.clientId,
    fullName: fields.fullName,
    roleCategory: fields.roleCategory,
    email: fields.email,
  };
}

/**
 * Parse a proposal's `args` JSON safely. Returns an empty object on
 * unparseable / non-object payloads so callers can iterate keys without
 * defensive null checks.
 */
function parseProposalArgs(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Edit-flow prefill fallback per the bug report on the multi-match candidate
 * picker save path.
 *
 * Slack `view_submission` is inconsistent about which blocks appear in
 * `view.state.values`: blocks whose `initial_value` / `initial_option` was
 * never user-touched may be omitted entirely. For untouched plain-text inputs
 * and external-select pickers in particular, that means our `readPlainText` /
 * `readSelect` returns null and `computeChangedFields` flags the field as a
 * change-to-null - the consumer then writes NULL to a column the user never
 * touched.
 *
 * The fix: enrich `canonical` BEFORE the diff with values that were persisted
 * onto `proposal.args` at multi-match-pick time (see
 * `handleMultiMatchCandidateSelect`). args becomes the prefill source-of-
 * truth; state.values overrides only for fields the user actually touched.
 *
 * Limited to STRING fields. Skips fields with known shape mismatches
 * between args and the row (most importantly `resources`, which is a
 * `string[]` in args but a CSV string in canonical/target).
 *
 * Trade-off: this masks "explicit clear" - if the user opens the modal,
 * deletes a prefilled title, and submits with the title field empty, the
 * fallback restores the prefill. Per the bug report we side with preserve
 * rather than clear; an actual clear can be performed by typing a single
 * space (or by editing the wrapper proposal flow). The cost of mis-clearing
 * fields the user never touched is much higher than the cost of failing to
 * clear fields the user emptied intentionally.
 */
const FALLBACK_FIELD_SKIP = new Set([
  // string[] in args, CSV string on the row - shape mismatch would always
  // flag as changed.
  "resources",
  // Booleans / objects / shape mismatches: keep this list narrow; only add
  // when we discover an actual hazard.
]);

/**
 * Task-only date fields. When the user toggles the dateType radio between
 * Single and Range mid-edit, the args persisted at multi-match-pick time
 * still reflect the prior mode's mirroring (Single: date == startDate ==
 * endDate). Falling back from those args after a toggle silently restores
 * stale dates that contradict the user's explicit toggle. This set is added
 * to the per-call skip when args.dateType disagrees with the submitted
 * dateType so the toggle invalidates carried-forward dates.
 */
const TASK_DATE_FIELDS_SKIP: ReadonlySet<string> = new Set([
  "date",
  "startDate",
  "endDate",
]);

/**
 * Infer the dateType ("single" | "range") an args bag represents. Prefers an
 * explicit `dateType` key; otherwise reads the start/end/date shape. Single-
 * mode rows mirror date into both startDate and endDate, so when all three
 * agree we treat the bag as single-mode.
 */
export function inferDateTypeFromArgs(
  args: Record<string, unknown>,
): "single" | "range" | undefined {
  const explicit = args.dateType;
  if (explicit === "single" || explicit === "range") return explicit;
  const start = typeof args.startDate === "string" ? args.startDate : "";
  const end = typeof args.endDate === "string" ? args.endDate : "";
  const date = typeof args.date === "string" ? args.date : "";
  if (date && start === date && end === date) return "single";
  if (start || end) return "range";
  if (date) return "single";
  return undefined;
}

function applyArgsFallback(
  canonical: Record<string, unknown>,
  args: Record<string, unknown>,
  extraSkip?: ReadonlySet<string>,
): void {
  for (const key of Object.keys(canonical)) {
    if (FALLBACK_FIELD_SKIP.has(key)) continue;
    if (extraSkip && extraSkip.has(key)) continue;
    const current = canonical[key];
    if (current !== null && current !== undefined) continue;
    const argVal = args[key];
    if (argVal === undefined || argVal === null || argVal === "") continue;
    // String-only fallback: shape mismatches between args and the row are
    // most likely on non-strings (resources -> array, dates that became
    // Date objects, etc.). Constraining to strings keeps the fallback
    // surgical.
    if (typeof argVal !== "string") continue;
    canonical[key] = argVal;
  }
}

/**
 * Compute the changed-field diff per pre-plan §C5. Compares each canonical
 * field to its corresponding value on the target row. Slot names that don't
 * exist on the target are treated as "potentially changed" (best-effort).
 *
 * Returns the names of fields whose normalized submitted value is not strictly
 * equal to the target's current value. Empty / null are unified via
 * normalizeEmptyToNull on both sides so an empty modal field doesn't show as a
 * change against a stored NULL.
 */
function computeChangedFields(
  canonical: Record<string, unknown>,
  target: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  for (const [key, submitted] of Object.entries(canonical)) {
    // Skip the L1/L2 "isRetainer" derived flag — it isn't a column.
    if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
    const current = target[key];
    const a =
      typeof submitted === "string" ? normalizeEmptyToNull(submitted) : submitted;
    const b =
      typeof current === "string" ? normalizeEmptyToNull(current) : current ?? null;
    if (a === b) continue;
    // Treat nullish equivalence (undefined vs null) as no-change.
    if ((a === null || a === undefined) && (b === null || b === undefined)) continue;
    changed.push(key);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export async function validateModalSubmission(
  params: ValidateModalSubmissionParams,
): Promise<ValidationResult> {
  const { proposal, stateValues, db } = params;
  const kind = modalKindFromToolName(proposal.toolName);
  const errors: SlackErrorsByBlockId = {};
  const softWarnings: string[] = [];

  // ── Edit-flow target lookup (target-still-exists check) ─────────────
  let targetEntity: Record<string, unknown> | null = null;
  if (proposal.kind === "edit") {
    if (!proposal.targetEntityId || !proposal.targetEntityType) {
      // Multi-match edit flow that reached submit without a target picker
      // resolution. Wave 2's multi_match_candidate_select handles this; if
      // we get here something upstream missed.
      errors["target_entity_block"] =
        "No edit target was selected. Cancel and try the edit command again.";
      return { ok: false, errors };
    }
    targetEntity = await loadTargetEntity(
      db,
      proposal.targetEntityType,
      proposal.targetEntityId,
    );
    if (!targetEntity) {
      const banner =
        kind === "project"
          ? "project_name_block"
          : kind === "task"
            ? "title_block"
            : "name_block";
      errors[banner] =
        "Target no longer exists - it may have been deleted. Cancel and search again.";
      return { ok: false, errors };
    }
  }

  // ── Per-modal extract + dispatch ────────────────────────────────────
  if (kind === "project") {
    return await validateProjectModal({
      proposal,
      stateValues,
      db,
      errors,
      softWarnings,
      targetEntity,
    });
  }
  if (kind === "task") {
    return await validateTaskModal({
      proposal,
      stateValues,
      db,
      errors,
      softWarnings,
      targetEntity,
    });
  }
  return await validateTeamMemberModal({
    proposal,
    stateValues,
    db,
    errors,
    softWarnings,
    targetEntity,
  });
}

// ---------------------------------------------------------------------------
// Project modal validator.
// ---------------------------------------------------------------------------

interface PerModalCtx {
  proposal: ProposalForValidation;
  stateValues: Record<string, Record<string, unknown>>;
  db: DbHandle;
  errors: SlackErrorsByBlockId;
  softWarnings: string[];
  targetEntity: Record<string, unknown> | null;
}

async function validateProjectModal(ctx: PerModalCtx): Promise<ValidationResult> {
  const fields = extractProjectFields(ctx.stateValues);
  const canonical = projectExtractToCanonical(fields);

  // Determine which keys we actually need to validate. Edit flow trims to
  // changed-field diff per pre-plan §C5.
  let changedFields: string[] | undefined;
  let fieldsToValidate: Set<string>;
  if (ctx.proposal.kind === "edit" && ctx.targetEntity) {
    // Prefill fallback: Slack omits untouched initial_value / initial_option
    // blocks from view.state.values. Backfill from proposal.args (persisted at
    // multi-match-pick time) so we don't diff a null against the target's
    // real value and mistakenly flag the field as a change-to-null.
    const argsObj = parseProposalArgs(ctx.proposal.args);
    applyArgsFallback(canonical, argsObj);
    changedFields = computeChangedFields(canonical, ctx.targetEntity);
    if (changedFields.length === 0) {
      ctx.errors["project_name_block"] =
        "No changes detected. Cancel or modify a field to submit.";
      return { ok: false, errors: ctx.errors };
    }
    fieldsToValidate = new Set(changedFields);
  } else {
    // Create flow validates everything.
    fieldsToValidate = new Set(Object.keys(canonical));
  }

  // ── Required-field check ────────────────────────────────────────────
  // Only enforced on create. Edit-flow callers may legitimately leave a
  // pre-existing required field unchanged on the target row.
  if (ctx.proposal.kind === "create") {
    if (!fields.name) ctx.errors["project_name_block"] = "Project name is required.";
    if (!fields.status) ctx.errors["status_block"] = "Status is required.";
    if (!fields.category) ctx.errors["category_block"] = "Category is required.";
    if (fields.isRetainer) {
      if (!fields.contractStart)
        ctx.errors["contract_start_block"] = "Contract start is required for retainers.";
      if (!fields.contractEnd)
        ctx.errors["contract_end_block"] = "Contract end is required for retainers.";
    }
    if (Object.keys(ctx.errors).length > 0) {
      return { ok: false, errors: ctx.errors };
    }
  }

  // ── Wave 0b validators (only on changed-or-create fields) ───────────

  // Status / category compatibility
  if (
    (fieldsToValidate.has("status") || fieldsToValidate.has("category")) &&
    fields.status &&
    fields.category
  ) {
    const r = validateStatusCategoryCompatibility(fields.status, fields.category);
    if (!r.ok) {
      if (r.soft) {
        ctx.softWarnings.push(r.error);
      } else {
        ctx.errors["status_block"] = r.error;
      }
    }
  }

  // Role-tag-on-resources
  if (fieldsToValidate.has("resources") || ctx.proposal.kind === "create") {
    // Inspect rows individually so we can key the error to the offending block.
    for (const row of fields.resourceRows) {
      if (row.name && (!row.role || row.role.trim() === "")) {
        ctx.errors[row.roleBlockId] =
          `Resources must include role prefix (e.g. 'CW: Kathy'). Missing role for ${row.name}.`;
      }
    }
    // Also run the canonical validator for completeness.
    if (fields.resources) {
      const r = validateRoleTagOnResources(fields.resources);
      if (!r.ok && !ctx.errors["resources_block_0"]) {
        ctx.errors["resources_block_0"] = r.error;
      }
    }
  }

  // startDate < endDate
  if (
    fieldsToValidate.has("startDate") ||
    fieldsToValidate.has("endDate") ||
    ctx.proposal.kind === "create"
  ) {
    const r = validateStartEndDateOrder(fields.startDate, fields.endDate);
    if (!r.ok) {
      ctx.errors["start_date_block"] = r.error;
    }
  }

  // contractStart < contractEnd
  if (
    fields.isRetainer ||
    fieldsToValidate.has("contractStart") ||
    fieldsToValidate.has("contractEnd")
  ) {
    const r = validateStartEndDateOrder(fields.contractStart, fields.contractEnd);
    if (!r.ok) {
      ctx.errors["contract_start_block"] = r.error.replace(
        /startDate|endDate/g,
        (m) => (m === "startDate" ? "contractStart" : "contractEnd"),
      );
    }
  }

  // Notes maxLength (L1)
  if ((fieldsToValidate.has("notes") || ctx.proposal.kind === "create") && fields.notes) {
    const r = validateNotesMaxLength(fields.notes, "L1");
    if (!r.ok) {
      ctx.errors["notes_block"] = r.error;
    }
  }

  // Past-date soft-warn (project's startDate against status)
  if (fields.startDate && fields.status) {
    const r = validatePastDateNonTerminal(fields.startDate, fields.status);
    if (r.ok && r.soft) {
      ctx.softWarnings.push(r.soft);
    }
  }

  // ── Modal-specific: parent-must-be-retainer (non-retainer mode) ─────
  if (
    !fields.isRetainer &&
    fields.parentProjectId &&
    (fieldsToValidate.has("parentProjectId") || ctx.proposal.kind === "create")
  ) {
    const parent = await loadProjectById(ctx.db, fields.parentProjectId);
    if (!parent) {
      ctx.errors["parent_retainer_block"] = "Selected parent project not found.";
    } else if (parent.engagementType !== "retainer") {
      ctx.errors["parent_retainer_block"] =
        "Parent must be a retainer wrapper. Pick a different parent or save without one.";
    }
  }

  // ── Title-collision soft-warn ──────────────────────────────────────
  if (fields.name && (fieldsToValidate.has("name") || ctx.proposal.kind === "create")) {
    const allProjects = await loadAllProjects(ctx.db);
    const candidates = allProjects
      .filter(
        (p) =>
          p.id !== ctx.proposal.targetEntityId &&
          (!fields.clientId || p.clientId === fields.clientId),
      )
      .map((p) => ({ name: String(p.name ?? ""), id: String(p.id ?? "") }));
    const matches = fuzzyMatchCandidates(
      fields.name,
      candidates,
      (c) => c.name,
      TITLE_COLLISION_THRESHOLD,
    );
    const warn = softWarnTitleCollision(matches, fields.name, "project");
    if (warn) ctx.softWarnings.push(warn);
  }

  // ── Wrapper-vs-child date-extension soft-warn (edit flow) ───────────
  if (
    ctx.proposal.kind === "edit" &&
    ctx.targetEntity &&
    typeof ctx.targetEntity.parentProjectId === "string" &&
    ctx.targetEntity.parentProjectId
  ) {
    const wrapper = await loadProjectById(
      ctx.db,
      ctx.targetEntity.parentProjectId,
    );
    if (wrapper && wrapper.engagementType === "retainer") {
      const wEnd = typeof wrapper.contractEnd === "string" ? wrapper.contractEnd : null;
      const wStart =
        typeof wrapper.contractStart === "string" ? wrapper.contractStart : null;
      if (
        fields.endDate &&
        wEnd &&
        fields.endDate > wEnd &&
        (fieldsToValidate.has("endDate") || (ctx.proposal.kind as string) === "create")
      ) {
        ctx.softWarnings.push(
          `End date '${fields.endDate}' exceeds the parent retainer wrapper's contract range (${wStart ?? "?"} - ${wEnd}). Confirm this is intended.`,
        );
      }
      if (
        fields.startDate &&
        wStart &&
        fields.startDate < wStart &&
        (fieldsToValidate.has("startDate") || (ctx.proposal.kind as string) === "create")
      ) {
        ctx.softWarnings.push(
          `Start date '${fields.startDate}' precedes the parent retainer wrapper's contract range (${wStart} - ${wEnd ?? "?"}). Confirm this is intended.`,
        );
      }
    }
  }

  if (Object.keys(ctx.errors).length > 0) return { ok: false, errors: ctx.errors };
  return {
    ok: true,
    normalized: canonical,
    changedFields,
    softWarnings: ctx.softWarnings.length > 0 ? ctx.softWarnings : undefined,
  };
}

// ---------------------------------------------------------------------------
// Task modal validator.
// ---------------------------------------------------------------------------

async function validateTaskModal(ctx: PerModalCtx): Promise<ValidationResult> {
  const fields = extractTaskFields(ctx.stateValues);
  const canonical = taskExtractToCanonical(fields);

  // ── Lazy parent resolution per pre-plan §A3 + §"Wave 9" ─────────────
  // resolved_project_id pre-set wins. Otherwise pendingProjectName drives a
  // fuzzy lookup. This runs BEFORE the required-field check so a successful
  // lookup satisfies the parent-required gate.
  let resolvedParentId: string | null = fields.parentProjectId;
  if (!resolvedParentId && ctx.proposal.resolvedProjectId) {
    resolvedParentId = ctx.proposal.resolvedProjectId;
  } else if (!resolvedParentId && ctx.proposal.pendingProjectName) {
    const allProjects = await loadAllProjects(ctx.db);
    // Match against the same client when we have one.
    const pool = fields.clientId
      ? allProjects.filter((p) => p.clientId === fields.clientId)
      : allProjects;
    const matches = fuzzyMatchCandidates(
      ctx.proposal.pendingProjectName,
      pool.map((p) => ({ id: String(p.id), name: String(p.name ?? "") })),
      (c) => c.name,
      0.6,
    );
    if (matches.length === 1) {
      resolvedParentId = matches[0].id;
    } else if (matches.length === 0) {
      ctx.errors["parent_project_block"] = PARENT_PROJECT_NOT_FOUND;
      return { ok: false, errors: ctx.errors };
    } else {
      ctx.errors["parent_project_block"] =
        `Multiple projects match '${ctx.proposal.pendingProjectName}'. Pick one in the parent picker.`;
      return { ok: false, errors: ctx.errors };
    }
  }
  canonical.projectId = resolvedParentId;
  // Mirror the canonical key under the snake_case form some callers expect.
  canonical.parent_project_id = resolvedParentId;

  // Determine which keys we actually need to validate.
  let changedFields: string[] | undefined;
  let fieldsToValidate: Set<string>;
  if (ctx.proposal.kind === "edit" && ctx.targetEntity) {
    // Prefill fallback: Slack omits untouched initial_value / initial_option
    // blocks from view.state.values. Backfill from proposal.args (persisted at
    // multi-match-pick time) so we don't diff a null against the target's
    // real value and mistakenly flag the field as a change-to-null.
    const argsObj = parseProposalArgs(ctx.proposal.args);
    // dateType toggle invalidates the prior mode's date fallback. If args
    // came from Single mode (date == startDate == endDate) and the user
    // toggled to Range, falling back endDate from args silently restores
    // the mirrored Single-day end while the user already moved startDate
    // forward, producing a startDate > endDate write-time rejection. Skip
    // the date trio whenever the inferred args dateType disagrees with the
    // submitted dateType - the user must explicitly pick the new mode's
    // dates.
    const argsDateType = inferDateTypeFromArgs(argsObj);
    const dateTypeChanged =
      argsDateType !== undefined &&
      fields.dateType !== undefined &&
      argsDateType !== fields.dateType;
    const extraSkip = dateTypeChanged ? TASK_DATE_FIELDS_SKIP : undefined;
    applyArgsFallback(canonical, argsObj, extraSkip);
    // When dateType toggled, require the new mode's date fields up front
    // so the user gets a clear "Start/End/Date is required" error instead
    // of a downstream write-time rejection.
    if (dateTypeChanged) {
      if (fields.dateType === "range") {
        if (!fields.startDate)
          ctx.errors["start_date_block"] = "Start date is required.";
        if (!fields.endDate)
          ctx.errors["end_date_block"] = "End date is required.";
      } else {
        if (!fields.date) ctx.errors["date_block"] = "Date is required.";
      }
      if (Object.keys(ctx.errors).length > 0) {
        return { ok: false, errors: ctx.errors };
      }
    }
    // For tasks, the target row uses `projectId` not `parentProjectId`.
    changedFields = computeChangedFields(canonical, ctx.targetEntity);
    if (changedFields.length === 0) {
      ctx.errors["title_block"] =
        "No changes detected. Cancel or modify a field to submit.";
      return { ok: false, errors: ctx.errors };
    }
    fieldsToValidate = new Set(changedFields);
  } else {
    fieldsToValidate = new Set(Object.keys(canonical));
  }

  // ── Required-field check (create flow) ──────────────────────────────
  if (ctx.proposal.kind === "create") {
    if (!fields.title) ctx.errors["title_block"] = "Title is required.";
    if (!fields.category) ctx.errors["category_block"] = "Category is required.";
    if (!resolvedParentId)
      ctx.errors["parent_project_block"] = "Parent project is required.";
    // Date requirements depend on date_type radio:
    //   single → date_block.date_picker required
    //   range  → start_date_block.start_date_picker AND end_date_block.end_date_picker required
    if (fields.dateType === "range") {
      if (!fields.startDate)
        ctx.errors["start_date_block"] = "Start date is required.";
      if (!fields.endDate)
        ctx.errors["end_date_block"] = "End date is required.";
    } else {
      if (!fields.date) ctx.errors["date_block"] = "Date is required.";
    }
    if (Object.keys(ctx.errors).length > 0) {
      return { ok: false, errors: ctx.errors };
    }
  }

  // ── Wave 0b validators ─────────────────────────────────────────────

  // Role-tag-on-resources
  if (fieldsToValidate.has("resources") || ctx.proposal.kind === "create") {
    for (const row of fields.resourceRows) {
      if (row.name && (!row.role || row.role.trim() === "")) {
        ctx.errors[row.roleBlockId] =
          `Resources must include role prefix. Missing role for ${row.name}.`;
      }
    }
    if (fields.resources) {
      const r = validateRoleTagOnResources(fields.resources);
      if (!r.ok && !ctx.errors["resources_block_0"]) {
        ctx.errors["resources_block_0"] = r.error;
      }
    }
  }

  // startDate < endDate (only when range type is set)
  if (
    fieldsToValidate.has("startDate") ||
    fieldsToValidate.has("endDate") ||
    ctx.proposal.kind === "create"
  ) {
    const r = validateStartEndDateOrder(fields.startDate, fields.endDate);
    if (!r.ok) {
      ctx.errors["start_date_block"] = r.error;
    }
  }

  // Notes maxLength (L2)
  if ((fieldsToValidate.has("notes") || ctx.proposal.kind === "create") && fields.notes) {
    const r = validateNotesMaxLength(fields.notes, "L2");
    if (!r.ok) {
      ctx.errors["notes_block"] = r.error;
    }
  }

  // Past-date soft-warn — week items default to status "scheduled" when none
  // is set client-side; we use that as the implicit non-terminal state.
  if (fields.date) {
    const r = validatePastDateNonTerminal(fields.date, "scheduled");
    if (r.ok && r.soft) ctx.softWarnings.push(r.soft);
  }

  // ── Title-collision soft-warn ──────────────────────────────────────
  if (fields.title && (fieldsToValidate.has("title") || ctx.proposal.kind === "create")) {
    const items = await loadAllWeekItems(ctx.db);
    const candidates = items
      .filter(
        (w) =>
          w.id !== ctx.proposal.targetEntityId &&
          (!resolvedParentId || w.projectId === resolvedParentId),
      )
      .map((w) => ({ id: String(w.id), name: String(w.title ?? "") }));
    const matches = fuzzyMatchCandidates(
      fields.title,
      candidates,
      (c) => c.name,
      TITLE_COLLISION_THRESHOLD,
    );
    const warn = softWarnTitleCollision(matches, fields.title, "task");
    if (warn) ctx.softWarnings.push(warn);
  }

  if (Object.keys(ctx.errors).length > 0) return { ok: false, errors: ctx.errors };
  return {
    ok: true,
    normalized: canonical,
    changedFields,
    softWarnings: ctx.softWarnings.length > 0 ? ctx.softWarnings : undefined,
  };
}

// ---------------------------------------------------------------------------
// Team Member modal validator.
// ---------------------------------------------------------------------------

async function validateTeamMemberModal(ctx: PerModalCtx): Promise<ValidationResult> {
  const fields = extractTeamMemberFields(ctx.stateValues);
  const canonical = teamMemberExtractToCanonical(fields);

  let changedFields: string[] | undefined;
  let fieldsToValidate: Set<string>;
  if (ctx.proposal.kind === "edit" && ctx.targetEntity) {
    // Prefill fallback: Slack omits untouched initial_value / initial_option
    // blocks from view.state.values. Backfill from proposal.args (persisted at
    // multi-match-pick time) so we don't diff a null against the target's
    // real value and mistakenly flag the field as a change-to-null.
    const argsObj = parseProposalArgs(ctx.proposal.args);
    applyArgsFallback(canonical, argsObj);
    changedFields = computeChangedFields(canonical, ctx.targetEntity);
    if (changedFields.length === 0) {
      ctx.errors["name_block"] =
        "No changes detected. Cancel or modify a field to submit.";
      return { ok: false, errors: ctx.errors };
    }
    fieldsToValidate = new Set(changedFields);
  } else {
    fieldsToValidate = new Set(Object.keys(canonical));
  }

  // ── Required-field check (create flow) ──────────────────────────────
  if (ctx.proposal.kind === "create") {
    if (!fields.fullName) ctx.errors["name_block"] = "Full name is required.";
    if (!fields.roleCategory)
      ctx.errors["role_category_block"] = "Role category is required.";
    if (Object.keys(ctx.errors).length > 0) {
      return { ok: false, errors: ctx.errors };
    }
  }

  // ── Title-collision soft-warn ──────────────────────────────────────
  if (
    fields.fullName &&
    (fieldsToValidate.has("fullName") || ctx.proposal.kind === "create")
  ) {
    const members = await loadAllTeamMembers(ctx.db);
    const candidates = members
      .filter((m) => m.id !== ctx.proposal.targetEntityId)
      .map((m) => ({
        id: String(m.id),
        name: String(m.fullName ?? m.name ?? ""),
      }));
    const matches = fuzzyMatchCandidates(
      fields.fullName,
      candidates,
      (c) => c.name,
      TITLE_COLLISION_THRESHOLD,
    );
    const warn = softWarnTitleCollision(matches, fields.fullName, "team member");
    if (warn) ctx.softWarnings.push(warn);
  }

  if (Object.keys(ctx.errors).length > 0) return { ok: false, errors: ctx.errors };
  return {
    ok: true,
    normalized: canonical,
    changedFields,
    softWarnings: ctx.softWarnings.length > 0 ? ctx.softWarnings : undefined,
  };
}
