/**
 * Read-only: find all weekItems where status='scheduled' (or null)
 * and startDate is in the past. These are stuck on the dashboard —
 * not visible in In Flight, but were supposed to have begun.
 */
import { or, isNull, eq, lt, and } from "drizzle-orm";
import { createRunwayDb, runIfDirect } from "../lib/run-script";
import { weekItems, projects, clients } from "../../src/lib/db/runway-schema";

const TODAY = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

runIfDirect("check-stale-scheduled", async () => {
  const { db } = createRunwayDb();
  console.log(`Today (UTC): ${TODAY}\n`);

  const rows = await db
    .select({
      id: weekItems.id,
      title: weekItems.title,
      status: weekItems.status,
      startDate: weekItems.startDate,
      endDate: weekItems.endDate,
      weekOf: weekItems.weekOf,
      owner: weekItems.owner,
      clientId: weekItems.clientId,
      projectId: weekItems.projectId,
    })
    .from(weekItems)
    .where(
      and(
        or(eq(weekItems.status, "scheduled"), isNull(weekItems.status)),
        lt(weekItems.startDate, TODAY)
      )
    );

  // hydrate client + project names
  const clientMap = new Map<string, string>();
  const projectMap = new Map<string, string>();
  for (const r of rows) {
    if (r.clientId && !clientMap.has(r.clientId)) {
      const c = await db.select().from(clients).where(eq(clients.id, r.clientId)).limit(1);
      clientMap.set(r.clientId, c[0]?.name ?? "(unknown)");
    }
    if (r.projectId && !projectMap.has(r.projectId)) {
      const p = await db.select().from(projects).where(eq(projects.id, r.projectId)).limit(1);
      projectMap.set(r.projectId, p[0]?.name ?? "(unknown)");
    }
  }

  // group by client
  const byClient = new Map<string, typeof rows>();
  for (const r of rows) {
    const cname = r.clientId ? (clientMap.get(r.clientId) ?? "(no client)") : "(no client)";
    if (!byClient.has(cname)) byClient.set(cname, []);
    byClient.get(cname)!.push(r);
  }

  if (rows.length === 0) {
    console.log("No stale-scheduled rows. Dashboard is clean.");
    return;
  }

  console.log(`Found ${rows.length} stale-scheduled L2(s):\n`);
  for (const [client, items] of [...byClient.entries()].sort()) {
    console.log(`━━ ${client} (${items.length}) ${"━".repeat(Math.max(0, 50 - client.length))}`);
    for (const r of items) {
      const proj = r.projectId ? projectMap.get(r.projectId) : "(no project)";
      const daysLate = Math.floor(
        (Date.parse(TODAY) - Date.parse(r.startDate!)) / 86_400_000
      );
      console.log(
        `  [${r.startDate} → ${r.endDate ?? "—"}]  ${daysLate}d late  ${r.title}`
      );
      console.log(`     project: ${proj}   owner: ${r.owner ?? "—"}`);
    }
    console.log("");
  }
});
