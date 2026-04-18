import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb } from "./operations-writes-test-helpers";

// ── Mock state ──────────────────────────────────────────
const { db: mockDb, mockInsertValues, mockUpdateSet } = createMockDb();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockDb,
}));

vi.mock("@/lib/db/runway-schema", () => ({
  teamMembers: { id: "id" },
  updates: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));

const mockResolveTeamMember = vi.fn();
const mockFindTeamMember = vi.fn();
const mockCheckIdempotency = vi.fn();

vi.mock("./operations-utils", () => ({
  TEAM_MEMBER_FIELDS: ["title", "fullName", "slackUserId", "roleCategory", "accountsLed", "isActive", "nicknames", "channelPurpose"],
  TEAM_MEMBER_FIELD_TO_COLUMN: {
    title: "title", fullName: "fullName", slackUserId: "slackUserId",
    roleCategory: "roleCategory", accountsLed: "accountsLed",
    isActive: "isActive", nicknames: "nicknames", channelPurpose: "channelPurpose",
  },
  generateIdempotencyKey: (...parts: string[]) => parts.join("|"),
  generateId: () => "test-id-123",
  resolveTeamMemberOrFail: async (name: string) => {
    return mockResolveTeamMember(name);
  },
  normalizeForMatch: (text: string) => text.trim().toLowerCase(),
  findTeamMemberByFuzzyName: async (name: string) => {
    return mockFindTeamMember(name);
  },
  checkDuplicate: async (idemKey: string, dupResult: unknown) => {
    if (await mockCheckIdempotency(idemKey)) return dupResult;
    return null;
  },
  insertAuditRecord: async (params: Record<string, unknown>) => {
    mockInsertValues(params);
  },
  getPreviousValue: (entity: Record<string, unknown>, columnKey: string) => String(entity[columnKey] ?? ""),
  validateAndResolveField: (field: string, allowed: readonly string[], fieldToColumn: Record<string, string>) => {
    if (!allowed.includes(field)) {
      return { ok: false, error: `Invalid field '${field}'. Allowed fields: ${allowed.join(", ")}` };
    }
    return { ok: true, typedField: field, columnKey: fieldToColumn[field] };
  },
}));

const teamMember = {
  id: "tm-1",
  name: "Ronan",
  firstName: "Ronan",
  fullName: "Ronan Lane",
  isActive: 1,
  accountsLed: '["convergix"]',
  title: "Project Manager",
  roleCategory: "pm",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIdempotency.mockResolvedValue(false);
});

describe("createTeamMember", () => {
  it("creates team member and audits", async () => {
    mockFindTeamMember.mockResolvedValue(null);

    const { createTeamMember } = await import("./operations-writes-team");
    const result = await createTeamMember({
      name: "NewPerson",
      firstName: "New",
      fullName: "New Person",
      title: "Designer",
      roleCategory: "creative",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.memberName).toBe("NewPerson");
    }
    expect(mockInsertValues).toHaveBeenCalledTimes(2); // member + audit
  });

  it("returns error for duplicate name", async () => {
    mockFindTeamMember.mockResolvedValue(teamMember);

    const { createTeamMember } = await import("./operations-writes-team");
    const result = await createTeamMember({
      name: "Ronan",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Ronan");
  });

  it("handles duplicate request", async () => {
    mockFindTeamMember.mockResolvedValue(null);
    mockCheckIdempotency.mockResolvedValue(true);

    const { createTeamMember } = await import("./operations-writes-team");
    const result = await createTeamMember({
      name: "NewPerson",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
  });
});

describe("updateTeamMember", () => {
  it("deactivates team member (isActive) and audits", async () => {
    mockResolveTeamMember.mockResolvedValue({ ok: true, member: teamMember });

    const { updateTeamMember } = await import("./operations-writes-team");
    const result = await updateTeamMember({
      memberName: "Ronan",
      field: "isActive",
      newValue: "0",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.previousValue).toBe("1");
      expect(result.data?.newValue).toBe("0");
    }
    // isActive should be stored as number
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: 0 })
    );
  });

  it("updates accountsLed field and audits", async () => {
    mockResolveTeamMember.mockResolvedValue({ ok: true, member: teamMember });

    const { updateTeamMember } = await import("./operations-writes-team");
    const result = await updateTeamMember({
      memberName: "Ronan",
      field: "accountsLed",
      newValue: '["convergix","lppc"]',
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.previousValue).toBe('["convergix"]');
      expect(result.data?.newValue).toBe('["convergix","lppc"]');
    }
  });

  it("returns error for unknown member with available list", async () => {
    mockResolveTeamMember.mockResolvedValue({
      ok: false,
      error: "Team member 'Unknown' not found.",
      available: ["Kathy", "Jill", "Ronan"],
    });

    const { updateTeamMember } = await import("./operations-writes-team");
    const result = await updateTeamMember({
      memberName: "Unknown",
      field: "isActive",
      newValue: "0",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unknown");
      expect(result.available).toEqual(["Kathy", "Jill", "Ronan"]);
    }
  });

  it("handles duplicate request", async () => {
    mockResolveTeamMember.mockResolvedValue({ ok: true, member: teamMember });
    mockCheckIdempotency.mockResolvedValue(true);

    const { updateTeamMember } = await import("./operations-writes-team");
    const result = await updateTeamMember({
      memberName: "Ronan",
      field: "isActive",
      newValue: "0",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain("duplicate");
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("rejects invalid field name", async () => {
    const { updateTeamMember } = await import("./operations-writes-team");
    const result = await updateTeamMember({
      memberName: "Ronan",
      field: "invalid",
      newValue: "foo",
      updatedBy: "jason",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("invalid");
  });

  it("includes metadata with field and memberName in audit record", async () => {
    mockResolveTeamMember.mockResolvedValue({ ok: true, member: teamMember });

    const { updateTeamMember } = await import("./operations-writes-team");
    await updateTeamMember({
      memberName: "Ronan",
      field: "title",
      newValue: "Senior PM",
      updatedBy: "jason",
    });

    const auditCall = mockInsertValues.mock.calls[0][0];
    expect(auditCall.metadata).toBe(JSON.stringify({ field: "title", memberName: "Ronan" }));
    expect(auditCall.updateType).toBe("team-member-change");
  });
});
