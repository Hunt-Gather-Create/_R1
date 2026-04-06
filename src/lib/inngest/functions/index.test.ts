import { describe, it, expect } from "vitest";
import * as functions from "./index";

describe("inngest functions barrel export", () => {
  it("exports all expected function handlers", () => {
    const expected = [
      "helloWorld",
      "trackFunctionInvoked",
      "trackFunctionFinished",
      "trackFunctionFailed",
      "researchBrandGuidelines",
      "generateBrandSummary",
      "executeAITask",
      "generateAudienceMembers",
      "generateSoul",
      "processRunwaySlackMessage",
    ];
    for (const name of expected) {
      expect(functions).toHaveProperty(name);
    }
  });

  it("exports exactly 10 functions", () => {
    const exportCount = Object.keys(functions).length;
    expect(exportCount).toBe(10);
  });
});
