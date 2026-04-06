import { describe, it, expect, vi } from "vitest";

vi.mock("inngest/next", () => ({
  serve: vi.fn().mockReturnValue({
    GET: vi.fn(),
    POST: vi.fn(),
    PUT: vi.fn(),
  }),
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { id: "auto-kanban" },
}));

vi.mock("@/lib/inngest/functions", () => ({
  helloWorld: { id: "hello-world" },
  trackFunctionInvoked: { id: "track-invoked" },
  trackFunctionFinished: { id: "track-finished" },
  trackFunctionFailed: { id: "track-failed" },
  researchBrandGuidelines: { id: "brand-research" },
  generateBrandSummary: { id: "brand-summary" },
  executeAITask: { id: "ai-task" },
  generateAudienceMembers: { id: "audience-gen" },
  generateSoul: { id: "soul-gen" },
  processRunwaySlackMessage: { id: "runway-slack" },
}));

import { serve } from "inngest/next";

describe("inngest route", () => {
  it("exports GET, POST, PUT handlers", async () => {
    const mod = await import("./route");
    expect(mod.GET).toBeDefined();
    expect(mod.POST).toBeDefined();
    expect(mod.PUT).toBeDefined();
  });

  it("calls serve with the inngest client and all functions", async () => {
    await import("./route");
    expect(serve).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.objectContaining({ id: "auto-kanban" }),
        functions: expect.arrayContaining([
          expect.objectContaining({ id: "hello-world" }),
          expect.objectContaining({ id: "runway-slack" }),
        ]),
      })
    );
  });

  it("registers exactly 10 functions", async () => {
    await import("./route");
    const call = vi.mocked(serve).mock.calls[0][0];
    expect(call.functions).toHaveLength(10);
  });
});
