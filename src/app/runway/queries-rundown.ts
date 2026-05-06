/**
 * Runway Gantt rundown queries — per-client pre-rendered Gantt sections.
 *
 * Returns a Map<clientId, RenderedClientRundownData> keyed by client.id.
 *
 * Architecture note: GanttTemplate.tsx imports react-dom/server and
 * themes.ts imports Node's fs module. Turbopack (Next.js 16) rejects any
 * server-component module graph that transitively imports react-dom/server.
 * The /api/runway/gantt-embed route handler is a separate Next.js entrypoint
 * (not subject to this restriction) that renders each client's sections and
 * returns pre-rendered HTML strings. This query function calls that route
 * during SSR so the module boundary stays clean.
 *
 * N+1 acknowledged: one fetch per client (~7-12 clients). Each fetch is
 * parallel via Promise.allSettled. Halt condition: page load >5s.
 */

import { asc } from "drizzle-orm";
import { getRunwayDb } from "@/lib/db/runway";
import { clients } from "@/lib/db/runway-schema";
import type { RenderedClientRundownData } from "./types";

/** Base URL for internal API calls during SSR. */
function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function fetchClientRundown(
  clientId: string,
  baseUrl: string,
  embedSecret: string | null,
): Promise<RenderedClientRundownData | null> {
  const url = `${baseUrl}/api/runway/gantt-embed?clientId=${encodeURIComponent(clientId)}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (embedSecret) headers["x-embed-secret"] = embedSecret;

  try {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) {
      console.error(`[queries-rundown] gantt-embed fetch failed for ${clientId}: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as RenderedClientRundownData;
    return data;
  } catch (err) {
    console.error(`[queries-rundown] gantt-embed fetch threw for ${clientId}:`, err);
    return null;
  }
}

export async function getClientRundowns(): Promise<Map<string, RenderedClientRundownData>> {
  const db = getRunwayDb();
  const baseUrl = getBaseUrl();
  const embedSecret = process.env.RUNWAY_EMBED_SECRET ?? null;

  // Fetch all clients alphabetically for stable ordering
  const allClients = await db.select().from(clients).orderBy(asc(clients.name));

  // Fan-out: fetch each client's rendered rundown in parallel
  const results = await Promise.allSettled(
    allClients.map((client) =>
      fetchClientRundown(client.id, baseUrl, embedSecret).then((data) => ({
        id: client.id,
        data,
      }))
    )
  );

  const map = new Map<string, RenderedClientRundownData>();
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.data) {
      map.set(result.value.id, result.value.data);
    }
  }
  return map;
}
