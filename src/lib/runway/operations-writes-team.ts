/**
 * Runway Write Operations — team member create and updates
 *
 * Create new team members and update individual fields (isActive, accountsLed, etc.)
 * with idempotency checks and audit logging.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { teamMembers } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import {
  TEAM_MEMBER_FIELDS,
  TEAM_MEMBER_FIELD_TO_COLUMN,
  generateIdempotencyKey,
  generateId,
  resolveTeamMemberOrFail,
  normalizeForMatch,
  findTeamMemberByFuzzyName,
  checkDuplicate,
  insertAuditRecord,
  validateAndResolveField,
  getPreviousValue,
} from "./operations-utils";
import type { OperationResult } from "./operations-utils";

// ── Create Team Member ──────────────────────────────────

export interface CreateTeamMemberParams {
  name: string;
  firstName?: string;
  fullName?: string;
  title?: string;
  slackUserId?: string;
  roleCategory?: string;
  accountsLed?: string;
  nicknames?: string;
  channelPurpose?: string;
  updatedBy: string;
}

export async function createTeamMember(
  params: CreateTeamMemberParams
): Promise<OperationResult> {
  const {
    name,
    firstName,
    fullName,
    title,
    slackUserId,
    roleCategory,
    accountsLed,
    nicknames,
    channelPurpose,
    updatedBy,
  } = params;

  // Check for existing member with same name (case-insensitive exact match)
  const existing = await findTeamMemberByFuzzyName(name);
  if (existing && normalizeForMatch(existing.name) === normalizeForMatch(name)) {
    return {
      ok: false,
      error: `A team member named '${existing.name}' already exists.`,
    };
  }

  const idemKey = generateIdempotencyKey(
    "create-team-member",
    name,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Team member already created (duplicate request).",
    data: { memberName: name },
  });
  if (dup) return dup;

  const db = getRunwayDb();
  const memberId = generateId();
  await db.insert(teamMembers).values({
    id: memberId,
    name,
    firstName: firstName ?? null,
    fullName: fullName ?? null,
    title: title ?? null,
    slackUserId: slackUserId ?? null,
    roleCategory: roleCategory ?? null,
    accountsLed: accountsLed ?? null,
    nicknames: nicknames ?? null,
    channelPurpose: channelPurpose ?? null,
    isActive: 1,
    updatedAt: new Date().toISOString(),
  });

  await insertAuditRecord({
    idempotencyKey: idemKey,
    updatedBy,
    updateType: "new-team-member",
    newValue: name,
    summary: `New team member added: ${name}`,
  });

  return {
    ok: true,
    message: `Added team member '${name}'.`,
    data: { memberName: name },
  };
}

// ── Update Team Member ──────────────────────────────────

export interface UpdateTeamMemberParams {
  memberName: string;
  field: string;
  newValue: string;
  updatedBy: string;
}

export async function updateTeamMember(
  params: UpdateTeamMemberParams
): Promise<OperationResult> {
  const { memberName, field, newValue, updatedBy } = params;
  const db = getRunwayDb();

  const fieldResult = validateAndResolveField(field, TEAM_MEMBER_FIELDS, TEAM_MEMBER_FIELD_TO_COLUMN);
  if (!fieldResult.ok) return fieldResult;
  const { typedField, columnKey } = fieldResult;

  const memberLookup = await resolveTeamMemberOrFail(memberName);
  if (!memberLookup.ok) return memberLookup;
  const member = memberLookup.member;

  const previousValue = getPreviousValue(member, columnKey);

  const idemKey = generateIdempotencyKey(
    "team-member-change",
    member.id,
    field,
    newValue,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already applied (duplicate request).",
    data: { memberName: member.name, field, previousValue, newValue },
  });
  if (dup) return dup;

  // isActive is stored as integer in the DB
  const dbValue = typedField === "isActive" ? Number(newValue) : newValue;

  await db
    .update(teamMembers)
    .set({ [columnKey]: dbValue, updatedAt: new Date().toISOString() })
    .where(eq(teamMembers.id, member.id));

  await insertAuditRecord({
    idempotencyKey: idemKey,
    updatedBy,
    updateType: "team-member-change",
    previousValue,
    newValue,
    summary: `Team member '${member.name}': ${field} changed from "${previousValue}" to "${newValue}"`,
    metadata: JSON.stringify({ field, memberName: member.name }),
  });

  return {
    ok: true,
    message: `Updated ${field} for team member '${member.name}'.`,
    data: { memberName: member.name, field, previousValue, newValue },
  };
}
