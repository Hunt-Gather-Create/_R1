import { describe, it, expect } from "vitest";
import {
  getInitials,
  getMemberInitials,
  getMemberDisplayName,
} from "./member-utils";
import type { WorkspaceMemberWithUser } from "@/lib/types";

// Factory helper for creating mock members
function createMember(
  overrides: Partial<WorkspaceMemberWithUser["user"]> = {}
): WorkspaceMemberWithUser {
  return {
    id: "member-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    role: "member",
    createdAt: new Date(),
    user: {
      id: "user-1",
      email: "john@example.com",
      firstName: "John",
      lastName: "Doe",
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    },
  };
}

describe("getInitials", () => {
  it("returns initials from first and last name", () => {
    expect(getInitials("John", "Doe", "john@example.com")).toBe("JD");
  });

  it("returns first two chars of first name when no last name", () => {
    expect(getInitials("John", null, "john@example.com")).toBe("JO");
  });

  it("returns first two chars of email when no name", () => {
    expect(getInitials(null, null, "john@example.com")).toBe("JO");
  });

  it("handles single character first name", () => {
    expect(getInitials("J", null, "j@example.com")).toBe("J");
  });

  it("returns ? when no data available", () => {
    expect(getInitials(null, null, undefined)).toBe("?");
  });

  it("uppercases the result", () => {
    expect(getInitials("john", "doe", "john@example.com")).toBe("JD");
  });

  it("handles empty strings as falsy", () => {
    expect(getInitials("", "", "test@example.com")).toBe("TE");
  });
});

describe("getMemberInitials", () => {
  it("extracts initials from member with full name", () => {
    const member = createMember({ firstName: "Jane", lastName: "Smith" });
    expect(getMemberInitials(member)).toBe("JS");
  });

  it("extracts initials from member with first name only", () => {
    const member = createMember({ firstName: "Jane", lastName: null });
    expect(getMemberInitials(member)).toBe("JA");
  });

  it("extracts initials from member with email only", () => {
    const member = createMember({
      firstName: null,
      lastName: null,
      email: "test@example.com",
    });
    expect(getMemberInitials(member)).toBe("TE");
  });
});

describe("getMemberDisplayName", () => {
  it("returns full name when both first and last name exist", () => {
    const member = createMember({ firstName: "John", lastName: "Doe" });
    expect(getMemberDisplayName(member)).toBe("John Doe");
  });

  it("returns first name when no last name", () => {
    const member = createMember({ firstName: "John", lastName: null });
    expect(getMemberDisplayName(member)).toBe("John");
  });

  it("returns email when no name", () => {
    const member = createMember({
      firstName: null,
      lastName: null,
      email: "john@example.com",
    });
    expect(getMemberDisplayName(member)).toBe("john@example.com");
  });

  it("returns email when first name is empty string", () => {
    const member = createMember({
      firstName: "",
      lastName: null,
      email: "john@example.com",
    });
    expect(getMemberDisplayName(member)).toBe("john@example.com");
  });
});
