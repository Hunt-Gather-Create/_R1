/**
 * Unit tests for src/lib/actions/gantt-render.ts.
 *
 * gantt-render.ts is a "use server" wrapper around generateGanttShare from
 * @/lib/runway/gantt/server. The wrapper exists to bypass Next.js 16 +
 * Turbopack's react-server module-condition restriction on react-dom/server
 * in App Router route module graphs (see file header), AND to gate the
 * server-action call surface behind a valid WorkOS session so that the
 * "use server" boundary cannot be exploited as an unauthenticated RPC
 * endpoint by a client component.
 *
 * Tests cover:
 *   1. Export shape — function + types are surfaced.
 *   2. Auth gate — wrapper rejects when no session is present.
 *   3. Happy path — wrapper delegates inputs to generateGanttShare verbatim
 *      when a valid session is present.
 *   4. Error path — errors raised by the underlying function propagate
 *      through the wrapper unchanged (auth-passing case).
 *   5. Call isolation — auth check + delegate fire exactly once per call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  GenerateGanttShareInput,
  GenerateGanttShareResult,
} from "./gantt-render";

// Mock the underlying gantt-server module the wrapper delegates to. We must
// mock before importing the wrapper so the import resolves to our spy.
const mockGenerateGanttShare = vi.fn();

vi.mock("@/lib/runway/gantt/server", () => ({
  generateGanttShare: mockGenerateGanttShare,
}));

// Mock the WorkOS-session helper. The wrapper requires a non-null user.
const mockGetCurrentUser = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

// Helper: build a canonical happy-path result.
function makeShareResult(
  overrides: Partial<GenerateGanttShareResult> = {},
): GenerateGanttShareResult {
  return {
    shareUrl: "https://runway.startround1.com/api/runway/gantt-share/tok_abc",
    expiresAt: "2026-05-12T00:00:00.000Z",
    summary: {
      kind: "client",
      clientName: "Test Client",
      sectionCount: 3,
      rowCount: 12,
      severity: { critical: 0, warn: 1, info: 2 },
    },
    ...overrides,
  };
}

// Helper: build a canonical happy-path input.
function makeShareInput(
  overrides: Partial<GenerateGanttShareInput> = {},
): GenerateGanttShareInput {
  return {
    clientSlug: "test-client",
    theme: "light-internal",
    ...overrides,
  };
}

// Helper: a minimal authenticated WorkOS user.
function makeUser() {
  return {
    id: "user_123",
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
    profilePictureUrl: null,
  };
}

describe("gantt-render server-action wrapper", () => {
  beforeEach(() => {
    mockGenerateGanttShare.mockReset();
    mockGetCurrentUser.mockReset();
  });

  describe("export shape", () => {
    it("exports generateGanttShare as a callable function", async () => {
      const mod = await import("./gantt-render");
      expect(mod.generateGanttShare).toBeDefined();
      expect(typeof mod.generateGanttShare).toBe("function");
    });
  });

  describe("auth gate — rejects unauthenticated invocations", () => {
    it("throws when getCurrentUser returns null (no WorkOS session)", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const { generateGanttShare } = await import("./gantt-render");

      await expect(generateGanttShare(makeShareInput())).rejects.toThrow(
        /without authentication context/,
      );
      // Critical: delegate must NOT be called when auth fails. This is the
      // whole point of the gate — no Runway data access without a session.
      expect(mockGenerateGanttShare).not.toHaveBeenCalled();
    });

    it("throws when getCurrentUser returns undefined", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(undefined);

      const { generateGanttShare } = await import("./gantt-render");

      await expect(generateGanttShare(makeShareInput())).rejects.toThrow(
        /without authentication context/,
      );
      expect(mockGenerateGanttShare).not.toHaveBeenCalled();
    });

    it("propagates errors thrown by getCurrentUser without calling delegate", async () => {
      mockGetCurrentUser.mockRejectedValueOnce(
        new Error("Failed to decrypt session"),
      );

      const { generateGanttShare } = await import("./gantt-render");

      await expect(generateGanttShare(makeShareInput())).rejects.toThrow(
        /Failed to decrypt session/,
      );
      expect(mockGenerateGanttShare).not.toHaveBeenCalled();
    });
  });

  describe("happy path — delegates to underlying generateGanttShare", () => {
    beforeEach(() => {
      // Default to authenticated for this group.
      mockGetCurrentUser.mockResolvedValue(makeUser());
    });

    it("forwards client-rundown input args verbatim and returns the resolved result", async () => {
      const expected = makeShareResult();
      mockGenerateGanttShare.mockResolvedValueOnce(expected);

      const { generateGanttShare } = await import("./gantt-render");
      const input = makeShareInput();
      const actual = await generateGanttShare(input);

      expect(mockGenerateGanttShare).toHaveBeenCalledTimes(1);
      expect(mockGenerateGanttShare).toHaveBeenCalledWith(input);
      expect(actual).toBe(expected);
    });

    it("forwards single-project input args (with projectSlug, origin, ttlDays) verbatim", async () => {
      const expected = makeShareResult({
        summary: {
          kind: "project",
          clientName: "Acme",
          projectName: "Q3 Launch",
          rowCount: 5,
          severity: { critical: 1, warn: 0, info: 0 },
        },
      });
      mockGenerateGanttShare.mockResolvedValueOnce(expected);

      const { generateGanttShare } = await import("./gantt-render");
      const input: GenerateGanttShareInput = {
        clientSlug: "acme",
        projectSlug: "q3-launch",
        theme: "dark-account-view",
        origin: "https://staging.example.com",
        ttlDays: 14,
      };
      const actual = await generateGanttShare(input);

      expect(mockGenerateGanttShare).toHaveBeenCalledTimes(1);
      expect(mockGenerateGanttShare).toHaveBeenCalledWith(input);
      expect(actual).toEqual(expected);
      // Ensure the wrapper did not mutate the result reference.
      expect(actual).toBe(expected);
    });

    it("supports the light-branded theme passthrough", async () => {
      const expected = makeShareResult();
      mockGenerateGanttShare.mockResolvedValueOnce(expected);

      const { generateGanttShare } = await import("./gantt-render");
      const input = makeShareInput({ theme: "light-branded" });
      await generateGanttShare(input);

      expect(mockGenerateGanttShare).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "light-branded" }),
      );
    });
  });

  describe("error path — surfaces underlying errors unchanged", () => {
    beforeEach(() => {
      mockGetCurrentUser.mockResolvedValue(makeUser());
    });

    it("propagates a thrown Error from the delegate", async () => {
      const err = new Error(
        'Client not found: "missing". Available: acme, beta',
      );
      mockGenerateGanttShare.mockRejectedValueOnce(err);

      const { generateGanttShare } = await import("./gantt-render");
      const input = makeShareInput({ clientSlug: "missing" });

      await expect(generateGanttShare(input)).rejects.toThrow(
        'Client not found: "missing". Available: acme, beta',
      );
      expect(mockGenerateGanttShare).toHaveBeenCalledTimes(1);
    });

    it("propagates an R2-not-configured error", async () => {
      mockGenerateGanttShare.mockRejectedValueOnce(
        new Error(
          "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.",
        ),
      );

      const { generateGanttShare } = await import("./gantt-render");

      await expect(generateGanttShare(makeShareInput())).rejects.toThrow(
        /R2 not configured/,
      );
    });

    it("does not swallow non-Error thrown values", async () => {
      mockGenerateGanttShare.mockRejectedValueOnce("string-rejection");

      const { generateGanttShare } = await import("./gantt-render");

      await expect(generateGanttShare(makeShareInput())).rejects.toBe(
        "string-rejection",
      );
    });
  });

  describe("call isolation", () => {
    it("invokes auth check + delegate exactly once per wrapper call", async () => {
      mockGetCurrentUser.mockResolvedValue(makeUser());
      mockGenerateGanttShare.mockResolvedValue(makeShareResult());

      const { generateGanttShare } = await import("./gantt-render");
      await generateGanttShare(makeShareInput());
      await generateGanttShare(makeShareInput({ clientSlug: "other" }));

      expect(mockGetCurrentUser).toHaveBeenCalledTimes(2);
      expect(mockGenerateGanttShare).toHaveBeenCalledTimes(2);
      expect(mockGenerateGanttShare).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ clientSlug: "test-client" }),
      );
      expect(mockGenerateGanttShare).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ clientSlug: "other" }),
      );
    });
  });
});
