import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { knowledgeAssets, workspaceMembers } from "@/lib/db/schema";
import { getCurrentUserId } from "@/lib/auth";
import { getObjectBinary } from "@/lib/storage/r2-client";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export async function GET(_req: Request, context: RouteContext) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId } = await context.params;
  const asset = await db
    .select({
      storageKey: knowledgeAssets.storageKey,
      mimeType: knowledgeAssets.mimeType,
    })
    .from(knowledgeAssets)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, knowledgeAssets.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .where(eq(knowledgeAssets.id, assetId))
    .get();

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const object = await getObjectBinary(asset.storageKey);
  if (!object) {
    return NextResponse.json({ error: "Asset content missing" }, { status: 404 });
  }

  const normalizedMimeType = asset.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    return NextResponse.json({ error: "Unsupported asset type" }, { status: 415 });
  }

  const body = object.body.buffer.slice(
    object.body.byteOffset,
    object.body.byteOffset + object.body.byteLength
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Content-Type": normalizedMimeType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
