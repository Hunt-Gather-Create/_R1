/**
 * Unit tests for src/lib/actions/gantt-render.ts.
 *
 * gantt-render.ts is a thin "use server" re-export wrapper around
 * generateGanttShare from @/lib/runway/gantt/server. The wrapper exists to
 * bypass Next.js 16 + Turbopack's react-server module-condition restriction
 * on react-dom/server in App Router route module graphs (see file header).
 *
 * Because the wrapper has no logic of its own (it is pure re-export), these
 * tests focus on:
 *   1. The expected named exports exist (function + types are surfaced).
 *   2. The wrapper delegates inputs to the underlying generateGanttShare
 *      verbatim (happy path).
 *   3. Errors raised by the underlying function propagate through the
 *      wrapper unchanged (error path).
 *   4. The wrapper does not mutate the resolved result.
 *
 * There is no auth gate in this wrapper (gantt-render.ts is invoked from
 * MCP tools and CLI paths that handle auth at their own layer); this test
 * file therefore does NOT mock requireWorkspaceAccess. If an auth gate is
 * later added inline to this wrapper, those assertions belong here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  GenerateGanttShareInput,
  GenerateGanttShareResult,
} from "./gantt-render";

// Mock the underlying module the wrapper re-exports from. We must mock
// before importing the wrapper so the re-export resolves to our spy.
const mockGenerateGanttShare = vi.fn();

vi.mock("@/lib/runway/gantt/server", () => ({
  generateGanttShare: mockGenerateGanttShare,
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

describe("gantt-render server-action wrapper", () => {
  beforeEach(() => {
    mockGenerateGanttShare.mockReset();
  });

  describe("export shape", () => {
    it("exports generateGanttShare as a callable function", async () => {
      const mod = await import("./gantt-render");
      expect(mod.generateGanttShare).toBeDefined();
      expect(typeof mod.generateGanttShare).toBe("function");
    });
  });

  describe("happy path — delegates to underlying generateGanttShare", () => {
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
    it("invokes the delegate exactly once per wrapper call", async () => {
      mockGenerateGanttShare.mockResolvedValue(makeShareResult());

      const { generateGanttShare } = await import("./gantt-render");
      await generateGanttShare(makeShareInput());
      await generateGanttShare(makeShareInput({ clientSlug: "other" }));

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
