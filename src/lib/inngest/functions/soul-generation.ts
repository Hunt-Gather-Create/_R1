import { inngest } from "../client";
import { db } from "@/lib/db";
import { workspaces, brands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type { WorkspaceSoul } from "@/lib/types";
import { MARKETING_PROJECT_TYPES } from "@/lib/marketing-project-types";

const GENERATION_MODEL = "claude-haiku-4-5-20251001";

const SOUL_SCHEMA = z.object({
  name: z.string().describe("A short, memorable chatbot name (1-2 words)"),
  personality: z.string().describe("2-3 sentence description of interaction style"),
  primaryGoals: z.array(z.string()).describe("3-5 main objectives"),
  tone: z.enum(["professional", "friendly", "casual", "formal"]),
  responseLength: z.enum(["concise", "moderate", "detailed"]),
  domainExpertise: z.array(z.string()).describe("3-5 areas of expertise"),
  terminology: z
    .array(
      z.object({
        term: z.string().describe("Domain-specific term"),
        definition: z.string().describe("Definition of the term"),
      })
    )
    .describe("5-10 domain-specific terms and definitions"),
  doRules: z.array(z.string()).describe("5-8 things the AI SHOULD do"),
  dontRules: z.array(z.string()).describe("3-5 things the AI should NOT do"),
  greeting: z.string().describe("Custom greeting message"),
});

export const generateSoul = inngest.createFunction(
  {
    id: "soul-generation",
    name: "Soul Generation from Brand",
    retries: 2,
    concurrency: {
      limit: 3,
    },
  },
  { event: "soul/generate" },
  async ({ event, step }) => {
    const {
      workspaceId,
      brandId,
      brandName,
      brandSummary,
      projectType,
      workspaceName,
    } = event.data;

    // Step 1: Fetch latest brand data (including guidelines if completed)
    const brandData = await step.run("fetch-brand-data", async () => {
      const brand = await db
        .select()
        .from(brands)
        .where(eq(brands.id, brandId))
        .get();

      return {
        name: brand?.name ?? brandName,
        summary: brand?.summary ?? brandSummary ?? null,
        industry: brand?.industry ?? null,
        tagline: brand?.tagline ?? null,
        guidelines: brand?.guidelines ?? null,
      };
    });

    // Step 2: Generate the soul
    const soulData = await step.run("generate-soul", async () => {
      const projectConfig =
        MARKETING_PROJECT_TYPES[
          projectType as keyof typeof MARKETING_PROJECT_TYPES
        ];
      const projectLabel = projectConfig?.label ?? projectType;

      let prompt = `Generate an AI assistant personality (soul) for a marketing workspace.

Workspace: "${workspaceName}"
Brand: ${brandData.name}
Project Type: ${projectLabel}`;

      if (brandData.industry) {
        prompt += `\nIndustry: ${brandData.industry}`;
      }

      if (brandData.tagline) {
        prompt += `\nTagline: ${brandData.tagline}`;
      }

      if (brandData.summary) {
        prompt += `\nBrand Summary: ${brandData.summary}`;
      }

      if (brandData.guidelines) {
        try {
          const guidelines = JSON.parse(brandData.guidelines);
          if (guidelines.voiceAndTone) {
            prompt += `\nBrand Voice: ${JSON.stringify(guidelines.voiceAndTone)}`;
          }
        } catch {
          // Ignore parse errors
        }
      }

      prompt += `

The AI assistant should be tailored for ${projectLabel} work. It should understand the brand's identity and help the team create on-brand content and strategies.

Generate a complete soul configuration.`;

      const result = await generateObject({
        model: anthropic(GENERATION_MODEL),
        schema: SOUL_SCHEMA,
        prompt,
      });

      return result.object;
    });

    // Step 3: Save to database
    const savedResult = await step.run("save-soul", async () => {
      const now = new Date().toISOString();
      const terminology = Object.fromEntries(
        soulData.terminology
          .map((entry) => [entry.term.trim(), entry.definition.trim()] as const)
          .filter(([term, definition]) => Boolean(term && definition))
      );

      const soul: WorkspaceSoul = {
        ...soulData,
        terminology,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };

      await db
        .update(workspaces)
        .set({
          soul: JSON.stringify(soul),
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, workspaceId));

      return { status: "completed", soulName: soul.name };
    });

    return savedResult;
  }
);
