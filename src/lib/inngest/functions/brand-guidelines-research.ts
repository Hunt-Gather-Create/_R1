import { inngest } from "../client";
import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool } from "ai";
import { z } from "zod";
import type { BrandGuidelines } from "@/lib/types";

const RESEARCH_MODEL = "claude-haiku-4-5-20251001";

const GUIDELINES_RESEARCH_PROMPT = `You are a brand guidelines research assistant. Your task is to find and extract brand guidelines for a company.

Your approach:
1. Search for "[brand name] brand guidelines", "[brand name] style guide", "[brand name] media kit", or "[brand name] press kit"
2. Fetch relevant pages/documents you find
3. If no official guidelines exist, fetch the brand's website and infer guidelines from their design
4. Extract structured guidelines data
5. Report your findings using the report_guidelines tool

What to extract (DO NOT extract colors - those are captured separately):
- **Logo rules**: How the logo should be used, clear space, minimum sizes, variations, what NOT to do with the logo
- **Typography**: Font family NAMES only (e.g., "Inter", "Helvetica Neue", "Georgia") - put font names in primaryFont/secondaryFont/headingFont/bodyFont fields. Do NOT put logo descriptions in typography.
- **Voice & Tone**: Brand personality characteristics, communication style, words/phrases to use and avoid
- **Imagery**: Photography style, illustration guidelines, visual aesthetic

IMPORTANT distinctions:
- Logo information (logo appearance, logo typography, logo variations) goes in the "logo" section
- Typography section is ONLY for general text fonts used across the brand, NOT logo-specific fonts
- Do NOT duplicate information between logo and typography sections

Confidence levels:
- **high**: Found official brand guidelines document or brand portal
- **medium**: Found marketing/press pages with brand info, or blog posts about their brand
- **low**: Inferred from website design and content (no official guidelines found)

IMPORTANT about notFound:
- Set notFound: false if you were able to extract ANY useful brand information (logo rules, typography, voice/tone, imagery, etc.)
- Set notFound: true ONLY if you truly couldn't find or infer anything useful about the brand

IMPORTANT: You MUST call the report_guidelines tool with your findings. Never respond without calling it.`;

// Schema for the report_guidelines tool
const reportGuidelinesSchema = z.object({
  notFound: z.boolean().optional().describe("Set to true ONLY if you couldn't extract ANY useful brand information. If you inferred colors, typography, voice/tone, or imagery from the website, set this to false."),
  logo: z.object({
    rules: z.array(z.string()).optional().describe("Logo usage rules"),
    clearSpace: z.string().optional().describe("Clear space requirements"),
    minimumSize: z.string().optional().describe("Minimum size requirements"),
    incorrectUsage: z.array(z.string()).optional().describe("Examples of incorrect logo usage"),
  }).optional(),
  colors: z.object({
    primary: z.object({
      name: z.string().optional(),
      hex: z.string().describe("Hex color code"),
      usage: z.string().optional().describe("When to use this color"),
    }).optional(),
    secondary: z.object({
      name: z.string().optional(),
      hex: z.string().describe("Hex color code"),
      usage: z.string().optional().describe("When to use this color"),
    }).optional(),
    palette: z.array(z.object({
      name: z.string().optional(),
      hex: z.string().describe("Hex color code"),
      usage: z.string().optional().describe("When to use this color"),
    })).optional().describe("Additional brand colors"),
  }).optional(),
  typography: z.object({
    primaryFont: z.string().optional().describe("Primary/headline font"),
    secondaryFont: z.string().optional().describe("Secondary font"),
    headingFont: z.string().optional().describe("Font for headings"),
    bodyFont: z.string().optional().describe("Font for body text"),
    rules: z.array(z.string()).optional().describe("Typography usage rules"),
  }).optional(),
  voiceAndTone: z.object({
    characteristics: z.array(z.string()).optional().describe("Brand personality traits"),
    doUse: z.array(z.string()).optional().describe("Words/phrases to use"),
    dontUse: z.array(z.string()).optional().describe("Words/phrases to avoid"),
  }).optional(),
  imagery: z.object({
    style: z.string().optional().describe("Overall imagery style"),
    guidelines: z.array(z.string()).optional().describe("Specific imagery guidelines"),
  }).optional(),
  sources: z.array(z.object({
    url: z.string(),
    title: z.string().optional(),
  })).optional().describe("URLs of sources used"),
  confidence: z.enum(["high", "medium", "low"]).describe("Confidence level based on source quality"),
  summary: z.string().optional().describe("Brief summary of the brand guidelines"),
});

const reportGuidelinesTool = tool({
  description: "Report the extracted brand guidelines. You MUST call this tool with your findings.",
  inputSchema: reportGuidelinesSchema,
  execute: async (input) => input,
});

export const researchBrandGuidelines = inngest.createFunction(
  {
    id: "brand-guidelines-research",
    name: "Brand Guidelines Research",
    retries: 2,
    concurrency: {
      limit: 3,
    },
  },
  { event: "brand/guidelines.research" },
  async ({ event, step }) => {
    const { brandId, brandName, websiteUrl } = event.data;

    // Step 1: Mark brand as processing
    await step.run("mark-processing", async () => {
      await db
        .update(brands)
        .set({
          guidelinesStatus: "processing",
          updatedAt: new Date(),
        })
        .where(eq(brands.id, brandId));

      return { status: "processing" };
    });

    // Step 2: Research guidelines using AI
    const guidelinesResult = await step.run("research-guidelines", async () => {
      const searchContext = websiteUrl
        ? `Brand: ${brandName}\nWebsite: ${websiteUrl}`
        : `Brand: ${brandName}`;

      const result = await generateText({
        model: anthropic(RESEARCH_MODEL),
        system: GUIDELINES_RESEARCH_PROMPT,
        prompt: `Research and extract brand guidelines for:\n\n${searchContext}\n\nSearch for their official brand guidelines, style guide, or media kit. Extract structured information about their logo usage, colors, typography, voice & tone, and imagery guidelines.`,
        tools: {
          web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }),
          web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 5 }),
          report_guidelines: reportGuidelinesTool,
        },
      });

      // Extract the tool result
      for (const stepResult of result.steps) {
        for (const toolResult of stepResult.toolResults) {
          if (toolResult.toolName === "report_guidelines" && "output" in toolResult) {
            return (toolResult as { output: z.infer<typeof reportGuidelinesSchema> }).output;
          }
        }
      }

      // Fallback if no tool was called
      return null;
    });

    // Step 3: Save results to database
    const savedResult = await step.run("save-results", async () => {
      const now = new Date();

      // Check if there's any useful content, even if notFound is true
      const hasUsefulContent = guidelinesResult && (
        guidelinesResult.logo ||
        guidelinesResult.colors ||
        guidelinesResult.typography ||
        guidelinesResult.voiceAndTone ||
        guidelinesResult.imagery
      );

      if (!guidelinesResult || (!hasUsefulContent && guidelinesResult.notFound)) {
        // Truly no guidelines found - no useful content extracted
        await db
          .update(brands)
          .set({
            guidelinesStatus: "not_found",
            guidelinesUpdatedAt: now,
            updatedAt: now,
          })
          .where(eq(brands.id, brandId));

        return { status: "not_found" };
      }

      // Build the guidelines object - save any useful content found
      // Even if notFound is true, we may have inferred guidelines from the website
      const guidelines: BrandGuidelines = {
        logo: guidelinesResult.logo,
        colors: guidelinesResult.colors,
        typography: guidelinesResult.typography,
        voiceAndTone: guidelinesResult.voiceAndTone,
        imagery: guidelinesResult.imagery,
        sources: guidelinesResult.sources?.map((s) => ({
          ...s,
          fetchedAt: now.toISOString(),
        })),
        lastUpdated: now.toISOString(),
        // If notFound but we have content, ensure confidence is "low"
        confidence: guidelinesResult.notFound ? "low" : guidelinesResult.confidence,
        summary: guidelinesResult.summary,
      };

      // Save to database
      await db
        .update(brands)
        .set({
          guidelines: JSON.stringify(guidelines),
          guidelinesStatus: "completed",
          guidelinesUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(brands.id, brandId));

      return {
        status: "completed",
        confidence: guidelinesResult.confidence,
        hasLogo: !!guidelinesResult.logo,
        hasColors: !!guidelinesResult.colors,
        hasTypography: !!guidelinesResult.typography,
        hasVoice: !!guidelinesResult.voiceAndTone,
      };
    });

    return savedResult;
  }
);
