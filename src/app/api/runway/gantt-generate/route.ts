/**
 * POST /api/runway/gantt-generate
 *
 * Internal endpoint that calls generateGanttShare from server.ts.
 *
 * Auth: Bearer token via RUNWAY_MCP_API_KEY (same key as the MCP endpoint).
 * This route is internal — do not expose to external callers or document publicly.
 *
 * Status codes:
 *   200 — generation succeeded → { shareUrl, expiresAt, summary }
 *   400 — missing or invalid input
 *   401 — missing or wrong Bearer token
 *   500 — generation failed (R2 not configured, DB error, render error)
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { generateGanttShare } from "@/lib/runway/gantt/server";
import type { Theme } from "@/lib/runway/gantt/types";

function validateAuth(request: NextRequest): boolean {
  const apiKey = process.env.RUNWAY_MCP_API_KEY;
  if (!apiKey) {
    throw new Error("RUNWAY_MCP_API_KEY is not configured");
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice("Bearer ".length);
  return token === apiKey;
}

export async function POST(request: NextRequest) {
  if (!validateAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const { clientSlug, projectSlug, theme, origin, ttlDays } = body as Record<string, unknown>;

  if (typeof clientSlug !== "string" || !clientSlug) {
    return NextResponse.json({ error: "clientSlug (string) is required" }, { status: 400 });
  }
  if (theme !== undefined && theme !== "light-internal" && theme !== "light-branded") {
    return NextResponse.json(
      { error: "theme must be 'light-internal' or 'light-branded'" },
      { status: 400 },
    );
  }

  try {
    const result = await generateGanttShare({
      clientSlug,
      projectSlug: typeof projectSlug === "string" ? projectSlug : undefined,
      theme: (theme as Theme) ?? "light-branded",
      origin: typeof origin === "string" ? origin : undefined,
      ttlDays: typeof ttlDays === "number" ? ttlDays : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
