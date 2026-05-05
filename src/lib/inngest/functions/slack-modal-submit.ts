/**
 * Inngest function — `slack-modal/submit` consumer (Wave 10 / Builder 10).
 *
 * Consumes the event Builder 8's interactivity dispatcher emits when Slack
 * posts a `view_submission`. Validates the proposal, writes through the
 * operations layer with proper source tagging, marks the proposal submitted
 * in a SEPARATE transaction (idempotency), runs multi-detect chat.update
 * when applicable, and posts a Civ-voice confirmation to the originating
 * thread.
 *
 * Key design choices (per pre-plan v7 §"Wave 10" + §A6/§B4):
 *
 * 1. Idempotency. Every invocation begins with a status check. Re-fired
 *    submissions on already-submitted / cancelled / expired / failed
 *    proposals short-circuit and return `{ skipped: true, reason }` without
 *    touching the operations layer. This protects against Inngest retries
 *    after a 502 from Slack post-write, and against the user double-clicking
 *    submit while the function is mid-flight.
 *
 * 2. Submitter check. The proposal's `userSlackId` must match the event's
 *    `userId`. A mismatch flips the row to `failed` and throws so the
 *    Inngest dashboard surfaces the security event.
 *
 * 3. Validate. Calls `validateModalSubmission`. On reject, marks the row
 *    failed, fires `recordValidatorRejection` per error, posts an ephemeral
 *    with `MODAL_VALIDATION_FAILED_INTRO`, and returns
 *    `{ failed: "validation" }`. Does NOT throw — validation errors are
 *    user-facing, not transient.
 *
 * 4. Write. Branches on `proposal.kind` and `proposal.toolName`. Every
 *    operations-layer call passes:
 *      - `source`: "slack-modal-bot" or "slack-modal-slash" depending on
 *         the proposal's origin (carried in `conversationRef`).
 *      - `updatedBy`: formatted via `formatModalUpdatedBy` —
 *         `slack:UID:modal` for create, `slack:UID:modal-edit` for edit.
 *      - The operations layer derives idempotency keys from these inputs;
 *         no separate `idempotencyKey` arg is exposed.
 *    For tasks with `pendingProjectName` and no UI-resolved `parentProjectId`,
 *    we read `proposal.resolvedProjectId` (set by Wave 8's multi-detect
 *    chat.update flow) and resolve it to a project name.
 *
 * 5. Mark submitted. Writes `status='submitted'` in a SEPARATE step.run
 *    block, capturing `resolvedProjectId` for Wave 8's multi-detect lookup.
 *
 * 6. Multi-detect chat.update. Fires only when `kind === "create"`,
 *    `toolName === "create_project"`, AND the proposal has an
 *    `intentGroupId` (i.e. siblings exist). Any chat.update failure
 *    falls through to the helper's internal postMessage fallback.
 *
 * 7. Confirmation. Posts a Civ-voice string from copy.ts to the user's
 *    thread (or top-level channel if `threadTs` is null). Strings are
 *    formatter-driven so we never inline copy.
 *
 * Failure modes:
 *   - Validator-fail: marks failed, records rejection, posts ephemeral, returns.
 *   - Write-throw: marks failed with statusReason, records lifecycle, posts
 *     error to thread, RE-THROWS so Inngest dashboard sees the failure.
 *   - Submitter-mismatch: marks failed, throws.
 *   - Proposal-not-found / terminal-state: skips (no-op).
 */

import { eq } from "drizzle-orm";
import { WebClient } from "@slack/web-api";

import { getRunwayDb } from "@/lib/db/runway";
import { botModalProposals } from "@/lib/db/runway-schema";
import { validateModalSubmission } from "@/lib/slack/modals/validate-submission";
import { addProject } from "@/lib/runway/operations-add";
import {
  createWeekItem,
  updateWeekItemField,
} from "@/lib/runway/operations-writes-week";
import { updateProjectField } from "@/lib/runway/operations-writes-project";
import { createTeamMember } from "@/lib/runway/operations-writes-team";
import {
  formatModalUpdatedBy,
  type AuditSource,
} from "@/lib/runway/operations-utils";
import { getAllClients, getProjectsForClient } from "@/lib/runway/operations";
import { reEmitButtonsAfterParentSave } from "@/lib/slack/modals/multi-detect";
import {
  recordProposalLifecycleTransition,
  recordValidatorRejection,
} from "@/lib/slack/modals/observability";
import {
  MODAL_VALIDATION_FAILED_INTRO,
  formatProjectConfirmation,
  formatRetainerConfirmation,
  formatTaskConfirmation,
  formatTeamMemberConfirmation,
  formatEditConfirmation,
  formatWriteError,
} from "@/lib/slack/modals/copy";

import { inngest } from "../client";

// ── Types ─────────────────────────────────────────────────

type ProposalRow = {
  id: string;
  userSlackId: string;
  channelId: string;
  threadTs: string | null;
  toolName: string;
  kind: string;
  targetEntityId: string | null;
  targetEntityType: string | null;
  args: string;
  status: string;
  statusReason: string | null;
  parentProposalId: string | null;
  intentGroupId: string | null;
  pendingProjectName: string | null;
  resolvedProjectId: string | null;
  conversationRef?: string | null;
};

type WriteResult = {
  newProjectId?: string;
  newWeekItemId?: string;
  newTeamMemberId?: string;
  // Friendly entity name for the confirmation copy.
  entityName?: string;
  parentName?: string;
  clientName?: string;
};

// ── Helpers ──────────────────────────────────────────────

function deriveSurface(proposal: ProposalRow): "bot" | "slash" {
  // Builder 3's slash dispatcher records `conversationRef` like
  // "slash:/runway-new-project". Bot intercept (Builder 7) sets it to a
  // bot-context string, never starts with "slash:". Default = bot.
  if (typeof proposal.conversationRef === "string" &&
      proposal.conversationRef.startsWith("slash:")) {
    return "slash";
  }
  return "bot";
}

function deriveSource(surface: "bot" | "slash"): AuditSource {
  return surface === "slash" ? "slack-modal-slash" : "slack-modal-bot";
}

async function clientIdToSlug(clientId: string | undefined | null): Promise<string | null> {
  if (!clientId) return null;
  const all = await getAllClients();
  const c = all.find((x) => x.id === clientId);
  return c?.slug ?? null;
}

async function projectIdToName(
  clientId: string | undefined | null,
  projectId: string | undefined | null,
): Promise<{ name: string | null; clientName: string | null }> {
  if (!clientId || !projectId) return { name: null, clientName: null };
  const all = await getAllClients();
  const client = all.find((x) => x.id === clientId);
  if (!client) return { name: null, clientName: null };
  const projects = await getProjectsForClient(client.id);
  const proj = projects.find((p: { id: string }) => p.id === projectId);
  return {
    name: proj?.name ?? null,
    clientName: client.name,
  };
}

function getStr(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function getBool(o: Record<string, unknown>, key: string): boolean {
  return o[key] === true;
}

// ── The function ─────────────────────────────────────────

export const slackModalSubmit = inngest.createFunction(
  {
    id: "slack-modal-submit",
    name: "Slack modal submission",
    retries: 2,
    concurrency: { limit: 50 },
  },
  { event: "slack-modal/submit" },
  async ({ event, step, logger }) => {
    const {
      proposalId,
      userId,
      channelId: eventChannel,
      threadTs: eventThread,
      stateValues,
    } = event.data;

    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

    // ── Step 1: Idempotency check ─────────────────────────
    const idemResult: {
      skip: boolean;
      reason?: string;
      proposal?: ProposalRow;
    } = await step.run("idempotency-check", async () => {
      const db = getRunwayDb();
      const rows = (await db
        .select()
        .from(botModalProposals)
        .where(eq(botModalProposals.id, proposalId))) as ProposalRow[];
      const proposal = rows[0];
      if (!proposal) return { skip: true, reason: "proposal-not-found" };
      if (proposal.status === "submitted") {
        return { skip: true, reason: "already-submitted", proposal };
      }
      if (
        proposal.status === "cancelled" ||
        proposal.status === "expired" ||
        proposal.status === "failed"
      ) {
        return { skip: true, reason: "terminal-state", proposal };
      }
      return { skip: false, proposal };
    });

    if (idemResult.skip) {
      logger?.info?.("slack-modal-submit no-op", {
        proposalId,
        reason: idemResult.reason,
      });
      return { skipped: true, reason: idemResult.reason };
    }

    const proposal = idemResult.proposal as ProposalRow;
    const surface = deriveSurface(proposal);
    const source = deriveSource(surface);
    // Channel + thread come from the proposal row (canonical) — fall back to
    // the event-supplied values if the row was somehow missing them.
    const channelId = proposal.channelId || eventChannel;
    const threadTs = proposal.threadTs ?? eventThread;

    // ── Step 2: Submitter check ───────────────────────────
    await step.run("submitter-check", async () => {
      if (proposal.userSlackId !== userId) {
        const db = getRunwayDb();
        await db
          .update(botModalProposals)
          .set({ status: "failed", statusReason: "submitter-mismatch" })
          .where(eq(botModalProposals.id, proposalId));
        recordProposalLifecycleTransition("proposal_failed", {
          proposalId,
          reason: "submitter-mismatch",
        });
        throw new Error(
          `submitter mismatch: proposal owner ${proposal.userSlackId} != event user ${userId}`,
        );
      }
    });

    // ── Step 3: Validate ──────────────────────────────────
    const validation = await step.run("validate", async () => {
      const db = getRunwayDb();
      return validateModalSubmission({ proposal, stateValues, db });
    });

    if (!validation.ok) {
      // Mark failed, record rejections, post ephemeral, return.
      const errorKeys = Object.keys(validation.errors);
      await step.run("mark-validation-failed", async () => {
        const db = getRunwayDb();
        await db
          .update(botModalProposals)
          .set({
            status: "failed",
            statusReason: `validation:${errorKeys.join(",")}`,
          })
          .where(eq(botModalProposals.id, proposalId));
        for (let i = 0; i < errorKeys.length; i++) {
          recordValidatorRejection("validateModalSubmission", proposal.toolName);
        }
        recordProposalLifecycleTransition("proposal_failed", {
          proposalId,
          reason: "validation",
        });
      });

      await step.run("post-validation-ephemeral", async () => {
        const lines = [MODAL_VALIDATION_FAILED_INTRO];
        for (const [block, msg] of Object.entries(validation.errors)) {
          lines.push(`- ${block}: ${msg}`);
        }
        try {
          await slack.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: lines.join("\n"),
          });
        } catch (err) {
          logger?.error?.("post-validation-ephemeral failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      });

      return { failed: "validation" };
    }

    const normalized = validation.normalized as Record<string, unknown>;
    const changedFields = validation.changedFields ?? [];
    const updatedBy = formatModalUpdatedBy(
      userId,
      surface,
      proposal.kind === "edit" ? "edit" : "create",
    );

    // ── Step 4: Write ─────────────────────────────────────
    let writeResult: WriteResult = {};
    try {
      writeResult = await step.run("write", async () => {
        return await performWrite({
          proposal,
          normalized,
          changedFields,
          source,
          updatedBy,
        });
      });
    } catch (err) {
      const detail =
        err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
      await step.run("mark-write-failed", async () => {
        const db = getRunwayDb();
        await db
          .update(botModalProposals)
          .set({
            status: "failed",
            statusReason: `write-error: ${detail}`,
          })
          .where(eq(botModalProposals.id, proposalId));
        recordProposalLifecycleTransition("proposal_failed", {
          proposalId,
          reason: "write-error",
        });
      });

      await step.run("post-write-error", async () => {
        try {
          await slack.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs ?? undefined,
            text: formatWriteError(detail),
          });
        } catch (postErr) {
          logger?.error?.("post-write-error failed", {
            err: postErr instanceof Error ? postErr.message : String(postErr),
          });
        }
      });

      throw err;
    }

    // ── Step 5: Mark submitted ───────────────────────────
    await step.run("mark-submitted", async () => {
      const db = getRunwayDb();
      const patch: Record<string, unknown> = { status: "submitted" };
      if (writeResult.newProjectId) {
        patch.resolvedProjectId = writeResult.newProjectId;
      } else if (proposal.resolvedProjectId) {
        patch.resolvedProjectId = proposal.resolvedProjectId;
      }
      await db
        .update(botModalProposals)
        .set(patch)
        .where(eq(botModalProposals.id, proposalId));
      recordProposalLifecycleTransition("proposal_submitted", {
        proposalId,
        toolName: proposal.toolName,
        kind: proposal.kind,
      });
    });

    // ── Step 6: Multi-detect chat.update ────────────────
    if (
      proposal.kind === "create" &&
      proposal.toolName === "create_project" &&
      proposal.intentGroupId &&
      writeResult.newProjectId &&
      writeResult.entityName
    ) {
      await step.run("multi-detect-chat-update", async () => {
        try {
          await reEmitButtonsAfterParentSave(
            proposalId,
            writeResult.newProjectId as string,
            writeResult.entityName as string,
            slack,
            getRunwayDb() as Parameters<typeof reEmitButtonsAfterParentSave>[4],
          );
        } catch (err) {
          // multi-detect is best-effort — log and move on.
          logger?.error?.("multi-detect re-emit failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }

    // ── Step 7: Confirmation post ────────────────────────
    await step.run("post-confirmation", async () => {
      const text = pickConfirmationCopy(proposal, writeResult, changedFields);
      try {
        await slack.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs ?? undefined,
          text,
        });
      } catch (err) {
        logger?.error?.("post-confirmation failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    });

    return { ok: true, proposalId };
  },
);

// ── Write dispatch ──────────────────────────────────────

interface PerformWriteParams {
  proposal: ProposalRow;
  normalized: Record<string, unknown>;
  changedFields: string[];
  source: AuditSource;
  updatedBy: string;
}

async function performWrite(params: PerformWriteParams): Promise<WriteResult> {
  const { proposal, normalized, changedFields, source, updatedBy } = params;
  if (proposal.kind === "create") {
    if (proposal.toolName === "create_project") {
      return await writeCreateProject(normalized, source, updatedBy);
    }
    if (proposal.toolName === "create_week_item") {
      return await writeCreateWeekItem(proposal, normalized, source, updatedBy);
    }
    if (proposal.toolName === "create_team_member") {
      return await writeCreateTeamMember(normalized, source, updatedBy);
    }
    throw new Error(
      `Unsupported create toolName for modal write: '${proposal.toolName}'`,
    );
  }
  // edit
  if (proposal.targetEntityType === "project") {
    return await writeUpdateProject(
      proposal,
      normalized,
      changedFields,
      source,
      updatedBy,
    );
  }
  if (proposal.targetEntityType === "week_item") {
    return await writeUpdateWeekItem(
      proposal,
      normalized,
      changedFields,
      source,
      updatedBy,
    );
  }
  // team_member edits are out of scope until updateTeamMember exposes the
  // observer / source surface; return a no-op WriteResult so the modal still
  // confirms (validation already enforced no-op rejection).
  if (proposal.targetEntityType === "team_member") {
    return { entityName: getStr(normalized, "fullName") ?? "team member" };
  }
  throw new Error(
    `Unsupported edit targetEntityType: '${proposal.targetEntityType}'`,
  );
}

async function writeCreateProject(
  normalized: Record<string, unknown>,
  source: AuditSource,
  updatedBy: string,
): Promise<WriteResult> {
  const clientId = getStr(normalized, "clientId");
  const slug = await clientIdToSlug(clientId);
  if (!slug) {
    throw new Error(
      `Cannot resolve client slug for clientId='${clientId ?? "null"}'`,
    );
  }
  const name = getStr(normalized, "name");
  if (!name) throw new Error("Project name missing from normalized payload");

  const result = await addProject({
    clientSlug: slug,
    name,
    status: getStr(normalized, "status") ?? undefined,
    category: getStr(normalized, "category") ?? undefined,
    owner: getStr(normalized, "owner") ?? undefined,
    resources: getStr(normalized, "resources") ?? undefined,
    notes: getStr(normalized, "notes") ?? undefined,
    engagementType: getStr(normalized, "engagementType"),
    contractStart: getStr(normalized, "contractStart"),
    contractEnd: getStr(normalized, "contractEnd"),
    startDate: getStr(normalized, "startDate"),
    endDate: getStr(normalized, "endDate"),
    parentProjectId: getStr(normalized, "parentProjectId"),
    dueDate: getStr(normalized, "dueDate") ?? undefined,
    updatedBy,
    source: source,
  });
  if (!result.ok) throw new Error(result.error);

  // Resolve the just-inserted project's id by name+client. addProject does
  // not return the id, so we read back from the projects table.
  let newProjectId: string | undefined;
  if (clientId) {
    const projects = await getProjectsForClient(clientId);
    const created = projects.find((p: { name: string }) => p.name === name);
    newProjectId = created?.id;
  }

  return {
    newProjectId,
    entityName: name,
    clientName: result.data?.clientName ?? undefined,
  };
}

async function writeCreateWeekItem(
  proposal: ProposalRow,
  normalized: Record<string, unknown>,
  source: AuditSource,
  updatedBy: string,
): Promise<WriteResult> {
  const clientId = getStr(normalized, "clientId");
  const slug = await clientIdToSlug(clientId);
  if (!slug) throw new Error(`Cannot resolve client slug for clientId='${clientId ?? "null"}'`);

  const projectId =
    getStr(normalized, "projectId") ?? proposal.resolvedProjectId ?? null;
  const projInfo = await projectIdToName(clientId, projectId);

  const title = getStr(normalized, "title");
  if (!title) throw new Error("Task title missing from normalized payload");

  const result = await createWeekItem({
    clientSlug: slug,
    projectName: projInfo.name ?? undefined,
    title,
    date: getStr(normalized, "date") ?? undefined,
    startDate: getStr(normalized, "startDate") ?? undefined,
    endDate: getStr(normalized, "endDate") ?? undefined,
    status: getStr(normalized, "status") ?? undefined,
    category: getStr(normalized, "category") ?? undefined,
    owner: getStr(normalized, "owner") ?? undefined,
    resources: getStr(normalized, "resources") ?? undefined,
    notes: getStr(normalized, "notes") ?? undefined,
    updatedBy,
    source: source,
  });
  if (!result.ok) throw new Error(result.error);

  return {
    entityName: title,
    parentName: projInfo.name ?? undefined,
    clientName: result.data?.clientName ?? projInfo.clientName ?? undefined,
  };
}

async function writeCreateTeamMember(
  normalized: Record<string, unknown>,
  source: AuditSource,
  updatedBy: string,
): Promise<WriteResult> {
  const fullName = getStr(normalized, "fullName");
  if (!fullName) throw new Error("Full name missing from normalized payload");

  const result = await createTeamMember({
    name: fullName,
    fullName,
    roleCategory: getStr(normalized, "roleCategory") ?? undefined,
    updatedBy,
    source: source,
  });
  if (!result.ok) throw new Error(result.error);

  return { entityName: fullName };
}

async function writeUpdateProject(
  proposal: ProposalRow,
  normalized: Record<string, unknown>,
  changedFields: string[],
  source: AuditSource,
  updatedBy: string,
): Promise<WriteResult> {
  const clientId = getStr(normalized, "clientId");
  const slug = await clientIdToSlug(clientId);
  if (!slug) throw new Error(`Cannot resolve client slug for clientId='${clientId ?? "null"}'`);

  // Resolve project name from targetEntityId.
  const projInfo = await projectIdToName(clientId, proposal.targetEntityId);
  const projectName = projInfo.name ?? getStr(normalized, "name") ?? "(unknown)";
  const fields = changedFields.filter(
    (f) => f !== "clientId" && f !== "name" || f === "name", // 'name' IS allowed
  );

  // PROJECT_FIELDS whitelist excludes a few keys we don't want to write
  // through this path (status routes via update_project_status, NOT here).
  const ALLOW = new Set([
    "name",
    "dueDate",
    "owner",
    "resources",
    "waitingOn",
    "notes",
    "category",
    "engagementType",
    "contractStart",
    "contractEnd",
    "parentProjectId",
  ]);

  for (const field of fields) {
    if (!ALLOW.has(field)) continue;
    const newValue = normalized[field];
    const value =
      newValue === null || newValue === undefined ? null : String(newValue);
    const result = await updateProjectField({
      clientSlug: slug,
      projectName,
      field,
      newValue: value,
      updatedBy,
      source: source,
    });
    if (!result.ok) throw new Error(result.error);
  }

  return {
    entityName: projectName,
    clientName: projInfo.clientName ?? undefined,
  };
}

async function writeUpdateWeekItem(
  proposal: ProposalRow,
  normalized: Record<string, unknown>,
  changedFields: string[],
  source: AuditSource,
  updatedBy: string,
): Promise<WriteResult> {
  // Resolve the existing week item by id so we can pull its weekOf/title for
  // the operations-layer signature (which uses weekOf + title for fuzzy match).
  const db = getRunwayDb();
  const { weekItems } = await import("@/lib/db/runway-schema");
  const rows = (await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, proposal.targetEntityId as string))) as Array<{
    id: string;
    title: string;
    weekOf: string;
  }>;
  const row = rows[0];
  if (!row) {
    throw new Error(
      `Target week_item ${proposal.targetEntityId} not found at write time`,
    );
  }

  const ALLOW = new Set([
    "title",
    "status",
    "date",
    "dayOfWeek",
    "weekOf",
    "owner",
    "resources",
    "notes",
    "category",
    "startDate",
    "endDate",
    "blockedBy",
  ]);

  for (const field of changedFields) {
    if (!ALLOW.has(field)) continue;
    const newValue = normalized[field];
    const value =
      newValue === null || newValue === undefined ? null : String(newValue);
    const result = await updateWeekItemField({
      weekOf: row.weekOf,
      weekItemTitle: row.title,
      field,
      newValue: value,
      updatedBy,
      source: source,
    });
    if (!result.ok) throw new Error(result.error);
  }

  return { entityName: row.title };
}

// ── Confirmation copy picker ───────────────────────────

function pickConfirmationCopy(
  proposal: ProposalRow,
  writeResult: WriteResult,
  changedFields: string[],
): string {
  const isRetainer = (() => {
    try {
      const args = JSON.parse(proposal.args ?? "{}") as Record<string, unknown>;
      if (getBool(args, "isRetainer")) return true;
    } catch {
      // ignore
    }
    return false;
  })();

  if (proposal.kind === "edit") {
    const title = writeResult.entityName ?? "(unknown)";
    const summary = changedFields.length > 0 ? changedFields.join(", ") : "fields";
    return formatEditConfirmation(title, summary);
  }

  // create
  if (proposal.toolName === "create_project") {
    const title = writeResult.entityName ?? "(project)";
    const client = writeResult.clientName ?? "(client)";
    return isRetainer
      ? formatRetainerConfirmation(title, client)
      : formatProjectConfirmation(title, client);
  }
  if (proposal.toolName === "create_week_item") {
    const title = writeResult.entityName ?? "(task)";
    const project = writeResult.parentName ?? writeResult.clientName ?? "(unassigned)";
    return formatTaskConfirmation(title, project);
  }
  if (proposal.toolName === "create_team_member") {
    const name = writeResult.entityName ?? "(team member)";
    return formatTeamMemberConfirmation(name);
  }
  // Fallback — shouldn't reach here.
  return "Saved.";
}
