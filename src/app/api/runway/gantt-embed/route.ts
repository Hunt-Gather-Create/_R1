/**
 * GET /api/runway/gantt-embed?clientId=<id>
 *
 * Returns pre-rendered HTML for all Gantt sections of a single client's
 * rundown. Used by queries-rundown.ts (called from page.tsx server component)
 * during SSR to obtain rendered Gantt HTML.
 *
 * Module boundary design:
 * GanttTemplate.tsx imports react-dom/server; themes.ts imports Node's fs.
 * Next.js 16 + Turbopack prohibits react-dom/server or fs in ANY App Router
 * entrypoint's static import graph — including route handlers.
 *
 * Solution: this route uses GanttSectionDark from gantt-section-dark.tsx —
 * a self-contained dark-theme renderer that imports neither react-dom/server
 * nor themes.ts. The route calls renderToStaticMarkup directly (allowed in
 * route handlers as long as no OTHER file in the static graph imports it).
 *
 * Auth: RUNWAY_EMBED_SECRET optional shared-secret gate.
 *
 * Response: { generatedAt, overallSeverity, sections: RenderedRundownSection[] }
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type NextRequest, NextResponse } from "next/server";
import { getRunwayDb } from "@/lib/db/runway";
import { clients, projects as projectsTable } from "@/lib/db/runway-schema";
import { extractClientRundown } from "@/lib/runway/gantt/extract-rundown";
import { GanttSectionDark } from "@/lib/runway/gantt/gantt-section-dark";
import { and, asc, eq, isNull } from "drizzle-orm";
import { toISODateString } from "@/app/runway/date-utils";
import type { RenderedRundownSection } from "@/app/runway/types";

const EMBED_SECRET = process.env.RUNWAY_EMBED_SECRET ?? null;

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Optional shared-secret gate (set RUNWAY_EMBED_SECRET in .env.local for prod)
  if (EMBED_SECRET) {
    const auth = request.headers.get("x-embed-secret");
    if (auth !== EMBED_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  const db = getRunwayDb();
  const now = new Date();
  const todayISO = toISODateString(now);
  const generatedAt = todayISO;

  // Fetch client
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Fetch top-level projects for this client
  const topLevelProjects = await db
    .select()
    .from(projectsTable)
    .where(and(isNull(projectsTable.parentProjectId), eq(projectsTable.clientId, clientId)))
    .orderBy(asc(projectsTable.sortOrder));

  const rundown = await extractClientRundown(
    db,
    client,
    topLevelProjects,
    generatedAt,
    todayISO,
  );

  const sections: RenderedRundownSection[] = rundown.sections.map((s) => ({
    anchor: s.anchor,
    kind: s.kind,
    title: s.title,
    parentTitle: s.parentTitle,
    renderedHtml: renderToStaticMarkup(
      createElement(GanttSectionDark, { data: s.data }),
    ),
  }));

  return NextResponse.json({
    generatedAt: rundown.generatedAt,
    overallSeverity: rundown.overallSeverity,
    sections,
  });
}
