import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  helloWorld,
  trackFunctionInvoked,
  trackFunctionFinished,
  trackFunctionFailed,
  researchBrandGuidelines,
  generateBrandSummary,
  executeAITask,
  generateAudienceMembers,
  generateSoul,
  processRunwaySlackMessage,
} from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    helloWorld,
    trackFunctionInvoked,
    trackFunctionFinished,
    trackFunctionFailed,
    researchBrandGuidelines,
    generateBrandSummary,
    executeAITask,
    generateAudienceMembers,
    generateSoul,
    processRunwaySlackMessage,
  ],
});
