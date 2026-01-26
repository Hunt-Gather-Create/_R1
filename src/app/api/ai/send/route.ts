import { NextRequest, NextResponse } from "next/server";
import { markSentToAI } from "@/lib/actions/issues";

export async function POST(request: NextRequest) {
  const { issueId } = await request.json();

  try {
    await markSentToAI(issueId);

    return NextResponse.json({
      success: true,
      message: "Issue sent to AI for processing",
      issueId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to send to AI",
      },
      { status: 500 }
    );
  }
}
