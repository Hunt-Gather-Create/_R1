/**
 * GET /api/runway/gantt-share/[token]
 *
 * Serves a pre-rendered HTML Gantt from R2 after verifying the HMAC token.
 *
 * Status codes:
 *   200 — valid token + R2 hit → HTML body
 *   404 — malformed/bad-signature/bad-version token OR R2 miss
 *   410 — expired token
 *   500 — R2 fetch threw unexpectedly
 *   405 — non-GET method
 *
 * Notes:
 * - NoIndex/NoFollow headers prevent search engine indexing.
 * - Cache-Control: private, max-age=300 allows browser caching only.
 * - OpenGraph meta tags intentionally omitted (operator Q2 confirmed SKIP).
 */

import { type NextRequest, NextResponse } from "next/server";
import { getContent } from "@/lib/storage/r2-client";
import { verifyToken } from "@/lib/runway/gantt/share-token";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const verification = verifyToken(token);

  if (!verification.ok) {
    if (verification.reason === "expired") {
      return new Response("Share link expired", { status: 410 });
    }
    // malformed | bad-signature | bad-version → 404 (don't help attackers)
    return new Response(null, { status: 404 });
  }

  const { payload } = verification;
  const storageKey = `gantt-share/${payload.nonce}/render.html`;

  let html: string | null;
  try {
    html = await getContent(storageKey);
  } catch (err) {
    console.error("[gantt-share] R2 fetch failed:", err);
    return new Response("R2 fetch failed", { status: 500 });
  }

  if (html === null) {
    return new Response(null, { status: 404 });
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function POST(): Promise<Response> {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function DELETE(): Promise<Response> {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
