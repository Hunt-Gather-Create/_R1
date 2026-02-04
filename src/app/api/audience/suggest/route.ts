import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces, workspaceMembers, brands } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { BrandGuidelines } from "@/lib/types";

const GENERATION_MODEL = "claude-haiku-4-5-20251001";

export const maxDuration = 30;

const inputSchema = z.object({
  workspaceId: z.string(),
});

const SUGGESTION_PROMPT = `You are a marketing strategist suggesting target audience demographics for a brand.

Based on the brand information provided, suggest an ideal target audience demographic for marketing purposes.

Consider:
- The brand's industry and positioning
- Their voice and tone (if available)
- Common customer segments for this type of brand
- Demographics that would benefit most from this brand

Respond with ONLY a JSON object (no markdown, no explanation) in this exact format:
{
  "suggestedName": "A name for this audience segment, e.g., 'Young Professionals'",
  "suggestedDescription": "A brief 1-sentence description of this audience segment for internal reference",
  "suggestedDemographic": "2-3 sentences describing the target demographic in detail",
  "suggestedTraits": ["trait1", "trait2", "trait3", "trait4", "trait5"]
}

Be specific and actionable. The description should be detailed enough to generate realistic persona profiles.`;

// Schema for validating the response
const suggestAudienceSchema = z.object({
  suggestedName: z.string(),
  suggestedDescription: z.string().optional(),
  suggestedDemographic: z.string(),
  suggestedTraits: z.array(z.string()),
});

export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId } = inputSchema.parse(body);

    // Get workspace and brand
    const workspace = await db
      .select({ id: workspaces.id, brandId: workspaces.brandId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    // Verify user has access to workspace
    const member = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId)
        )
      )
      .get();

    if (!member) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    if (!workspace.brandId) {
      return NextResponse.json(
        { error: "Workspace has no brand configured" },
        { status: 400 }
      );
    }

    const brand = await db
      .select()
      .from(brands)
      .where(eq(brands.id, workspace.brandId))
      .get();

    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    // Build brand context
    let brandContext = `Brand: ${brand.name}`;

    if (brand.industry) {
      brandContext += `\nIndustry: ${brand.industry}`;
    }

    if (brand.description) {
      brandContext += `\nDescription: ${brand.description}`;
    }

    if (brand.tagline) {
      brandContext += `\nTagline: ${brand.tagline}`;
    }

    if (brand.guidelines) {
      try {
        const guidelines: BrandGuidelines = JSON.parse(brand.guidelines);
        if (guidelines.voiceAndTone) {
          if (guidelines.voiceAndTone.characteristics?.length) {
            brandContext += `\nVoice & Tone: ${guidelines.voiceAndTone.characteristics.join(", ")}`;
          }
          if (guidelines.voiceAndTone.doUse?.length) {
            brandContext += `\nCommunication style: ${guidelines.voiceAndTone.doUse.slice(0, 3).join(", ")}`;
          }
        }
        if (guidelines.summary) {
          brandContext += `\nBrand Summary: ${guidelines.summary}`;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Generate suggestion
    const result = await generateText({
      model: anthropic(GENERATION_MODEL),
      system: SUGGESTION_PROMPT,
      prompt: brandContext,
    });

    // Parse the JSON response
    const text = result.text.trim();

    // Try to extract JSON from the response (in case AI adds markdown)
    let jsonText = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonText);
    const suggestion = suggestAudienceSchema.parse(parsed);

    return NextResponse.json(suggestion);
  } catch (error) {
    console.error("Audience suggest error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate suggestion" },
      { status: 500 }
    );
  }
}
