import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { db } from "@/lib/db";
import { workspaces, workspaceMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth";
import { loadSkill } from "@/lib/chat/skills";

const MODEL = "claude-haiku-4-5-20251001";

/**
 * Generate a skill using AI based on user description
 */
export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { prompt, workspaceId } = (await req.json()) as {
      prompt: string;
      workspaceId: string;
    };

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace ID required" },
        { status: 400 }
      );
    }

    // Verify workspace exists and user has admin access
    const workspace = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

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

    if (!member || member.role !== "admin") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    // Load the skill-builder skill for instructions
    const skillBuilderSkill = await loadSkill("skill-builder");

    if (!skillBuilderSkill) {
      return NextResponse.json(
        { error: "Skill builder not available" },
        { status: 500 }
      );
    }

    // Build the system prompt from the skill
    const systemPrompt = `${skillBuilderSkill.content}

IMPORTANT: Output ONLY the complete markdown content for the skill (including the YAML frontmatter). Do not include any explanations, commentary, or markdown code fences around the output. The output should start with "---" and end with the skill content.`;

    // Generate the skill using AI
    const result = await generateText({
      model: anthropic(MODEL),
      system: systemPrompt,
      prompt: `Create a skill based on this description: ${prompt}`,
    });

    const markdown = result.text.trim();

    // Validate the generated markdown has frontmatter
    if (!markdown.startsWith("---")) {
      return NextResponse.json(
        { error: "Generated skill is missing frontmatter" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      markdown,
    });
  } catch (error) {
    console.error("Skill generation error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate skill",
      },
      { status: 500 }
    );
  }
}
