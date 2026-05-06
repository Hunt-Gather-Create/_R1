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
 * Auth: RUNWAY_EMBED_SECRET shared-secret gate. Required in production —
 * if unset in prod, the route hard-fails with 500 rather than silently
 * disabling auth. In development, missing secret logs a warning and
 * proceeds without auth so local rendering keeps working.
 *
 * Response: { generatedAt, overallSeverity, sections: RenderedRundownSection[] }
 */

import { createElement } from "react";
// Turbopack walls static `import ... from "react-dom/server"` in any App Router
// entrypoint's import graph (including route handlers). The require() call
// bypasses static analysis; same workaround used in
// src/lib/runway/gantt/GanttTemplate.tsx.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
import { type NextRequest, NextResponse } from "next/server";
import { getRunwayDb } from "@/lib/db/runway";
import { clients, projects as projectsTable } from "@/lib/db/runway-schema";
import { extractClientRundown } from "@/lib/runway/gantt/server";
import { GanttSectionDark } from "@/lib/runway/gantt/gantt-section-dark";
import { and, asc, eq, isNull } from "drizzle-orm";
import { toISODateString } from "@/app/runway/date-utils";
import type { RenderedRundownSection } from "@/app/runway/types";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Shared-secret gate. Read at request time (not module init) so
  // environment changes are picked up and tests can stub the var.
  const embedSecret = process.env.RUNWAY_EMBED_SECRET;
  if (!embedSecret) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[gantt-embed] RUNWAY_EMBED_SECRET is not configured in production — refusing to serve",
      );
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }
    // Dev/test only — allow without auth, but log so the gap is visible.
    console.warn(
      "[gantt-embed] RUNWAY_EMBED_SECRET unset (non-production) — proceeding without auth",
    );
  } else {
    const auth = request.headers.get("x-embed-secret");
    if (auth !== embedSecret) {
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
