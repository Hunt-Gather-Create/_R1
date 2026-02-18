import { NextResponse } from "next/server";
import { z } from "zod";
import { syncWorkspaceKnowledge } from "@/lib/ai-search/client";
import { requireWorkspaceAccess } from "@/lib/actions/workspace";

const syncRequestSchema = z.object({
  workspaceId: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = syncRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { workspaceId } = parsed.data;
    await requireWorkspaceAccess(workspaceId, "member");
    await syncWorkspaceKnowledge(workspaceId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Knowledge sync failed:", error);
    return NextResponse.json({ error: "Failed to sync knowledge index" }, { status: 500 });
  }
}
