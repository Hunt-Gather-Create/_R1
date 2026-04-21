/**
 * PR #86 MCP Smoke Test — READ-ONLY integration check against prod Turso.
 *
 * Verifies 7 new/enriched read operations from @/lib/runway/operations against
 * live data. No mutations. No commits. Throwaway artifact.
 *
 * Usage: pnpm tsx docs/tmp/pr86-mcp-smoke-test.ts
 */

import { loadEnvLocal } from "../../scripts/lib/load-env";
loadEnvLocal();

// Dynamic import AFTER env is loaded so getRunwayDb() sees RUNWAY_DATABASE_URL.
type PassFail = { kind: "pass"; label: string; detail?: string }
  | { kind: "fail"; label: string; detail: string };

const results: PassFail[] = [];
const errors: { fn: string; err: unknown }[] = [];

function pass(label: string, detail?: string) {
  results.push({ kind: "pass", label, detail });
  console.log(`  PASS: ${label}${detail ? ` (${detail})` : ""}`);
}
function fail(label: string, detail: string) {
  results.push({ kind: "fail", label, detail });
  console.log(`  FAIL: ${label} — ${detail}`);
}

function section(title: string) {
  console.log("");
  console.log("─".repeat(72));
  console.log(title);
  console.log("─".repeat(72));
}

async function main() {
  const ops = await import("@/lib/runway/operations");

  const url = process.env.RUNWAY_DATABASE_URL;
  console.log(`RUNWAY_DATABASE_URL: ${url ? url.replace(/(libsql:\/\/)[^.]+/, "$1***") : "(unset)"}`);
  if (!url) {
    console.error("RUNWAY_DATABASE_URL not set — aborting");
    process.exit(1);
  }
  if (!url.startsWith("libsql://")) {
    console.warn(`WARN: URL is not libsql:// — may be pointing at a local DB, not prod Turso`);
  }

  // ── 1. getDataHealth ──────────────────────────────────
  section("1. getDataHealth()");
  try {
    const h = await ops.getDataHealth();
    console.log(JSON.stringify(
      {
        totals: h.totals,
        orphans: h.orphans,
        stale: h.stale,
        batch: h.batch,
        lastUpdateAt: h.lastUpdateAt?.toISOString() ?? null,
      },
      null,
      2
    ));

    if (h.totals.projects > 20) pass("totals.projects > 20", `${h.totals.projects}`);
    else fail("totals.projects > 20", `got ${h.totals.projects}`);

    if (h.totals.weekItems > 100) pass("totals.weekItems > 100", `${h.totals.weekItems}`);
    else fail("totals.weekItems > 100", `got ${h.totals.weekItems}`);

    if (h.totals.clients > 10) pass("totals.clients > 10", `${h.totals.clients}`);
    else fail("totals.clients > 10", `got ${h.totals.clients}`);

    const orphanPct = h.totals.weekItems > 0
      ? (h.orphans.weekItemsWithoutProject / h.totals.weekItems) * 100
      : 0;
    if (orphanPct < 5) {
      pass("orphan week_items < 5%", `${h.orphans.weekItemsWithoutProject}/${h.totals.weekItems} = ${orphanPct.toFixed(1)}%`);
    } else {
      fail("orphan week_items < 5%", `${orphanPct.toFixed(1)}%`);
    }

    if (typeof h.stale.staleProjects === "number" && typeof h.stale.pastEndL2s === "number") {
      pass("stale counts returned", `stale=${h.stale.staleProjects} pastEndL2s=${h.stale.pastEndL2s}`);
    } else {
      fail("stale counts returned", `stale=${JSON.stringify(h.stale)}`);
    }
  } catch (err) {
    errors.push({ fn: "getDataHealth", err });
    fail("getDataHealth threw", (err as Error).message);
  }

  // ── 2. getClientDetail('convergix') ───────────────────
  section("2. getClientDetail('convergix')");
  try {
    const d = await ops.getClientDetail("convergix");
    if (!d) {
      fail("client row present", "getClientDetail returned null for 'convergix'");
    } else {
      console.log(JSON.stringify({
        id: d.id,
        name: d.name,
        slug: d.slug,
        contractStatus: d.contractStatus,
        projectsCount: d.projects.length,
        pipelineCount: d.pipelineItems.length,
        updatesCount: d.recentUpdates.length,
      }, null, 2));

      pass("client row present", `name=${d.name} slug=${d.slug}`);

      if (d.projects.length > 10) pass("projects array > 10", `${d.projects.length} projects`);
      else fail("projects array > 10", `got ${d.projects.length}`);

      if (Array.isArray(d.pipelineItems)) pass("pipeline array returned", `${d.pipelineItems.length} items`);
      else fail("pipeline array returned", `type=${typeof d.pipelineItems}`);

      if (Array.isArray(d.recentUpdates)) pass("updates array returned", `${d.recentUpdates.length} items`);
      else fail("updates array returned", `type=${typeof d.recentUpdates}`);

      // Sample first 3 project names
      if (d.projects.length > 0) {
        const sample = d.projects.slice(0, 3).map((p) => `${p.name} [${p.status}]`);
        console.log(`  First 3 projects: ${sample.join(" | ")}`);
      }
    }
  } catch (err) {
    errors.push({ fn: "getClientDetail", err });
    fail("getClientDetail threw", (err as Error).message);
  }

  // ── 3. getFlags({ personName: 'Kathy' }) ──────────────
  section("3. getFlags({ personName: 'Kathy' })");
  try {
    const f = await ops.getFlags({ personName: "Kathy" });
    const flagKinds = new Set((f.flags ?? []).map((x) => x.kind));
    console.log(JSON.stringify({
      totalFlags: f.flags.length,
      kinds: [...flagKinds],
      retainerRenewalDue: f.retainerRenewalDue.length,
      contractExpired: f.contractExpired.length,
    }, null, 2));

    if (Array.isArray(f.flags)) pass("flags array returned", `${f.flags.length} flags, kinds=[${[...flagKinds].join(",")}]`);
    else fail("flags array returned", `type=${typeof f.flags}`);

    if (Array.isArray(f.retainerRenewalDue)) {
      // Kathy expected: no retainers (LPPC / Convergix are project-type).
      if (f.retainerRenewalDue.length === 0) {
        pass("Kathy has no retainer-renewal flags (expected)");
      } else {
        pass(
          `Kathy has ${f.retainerRenewalDue.length} retainer-renewal flag(s) — unexpected but non-fatal`,
          f.retainerRenewalDue.map((r) => r.projectName).slice(0, 3).join(", ")
        );
      }
    } else {
      fail("retainerRenewalDue is array", `type=${typeof f.retainerRenewalDue}`);
    }

    if (Array.isArray(f.contractExpired)) pass("contractExpired is array", `${f.contractExpired.length} entries`);
    else fail("contractExpired is array", `type=${typeof f.contractExpired}`);
  } catch (err) {
    errors.push({ fn: "getFlags", err });
    fail("getFlags threw", (err as Error).message);
  }

  // ── 4. getCascadeLog(1440) ────────────────────────────
  section("4. getCascadeLog(1440)  // last 24h");
  try {
    const c = await ops.getCascadeLog(1440);
    console.log(JSON.stringify({
      windowMinutes: c.windowMinutes,
      since: c.since.toISOString(),
      totalCascadeRows: c.totalCascadeRows,
      groupCount: c.groups.length,
    }, null, 2));
    pass("getCascadeLog returned", `${c.totalCascadeRows} cascade rows in ${c.groups.length} groups`);
    if (c.groups.length > 0) {
      const g = c.groups[0];
      console.log(`  Most recent group: parent=${g.parent?.updateType ?? "(null)"} children=${g.children.length}`);
    }
  } catch (err) {
    errors.push({ fn: "getCascadeLog", err });
    fail("getCascadeLog threw", (err as Error).message);
  }

  // ── 5. getCurrentBatch() ──────────────────────────────
  section("5. getCurrentBatch()");
  try {
    const b = await ops.getCurrentBatch();
    console.log(JSON.stringify(b, null, 2));
    if (b.active === false) pass("active: false (no in-process batch)");
    else pass(`batch active (unexpected but non-fatal)`, `id=${b.batchId} count=${b.itemCount}`);
  } catch (err) {
    errors.push({ fn: "getCurrentBatch", err });
    fail("getCurrentBatch threw", (err as Error).message);
  }

  // ── 6. getPersonWorkload('Kathy') — v4 shape check ────
  section("6. getPersonWorkload('Kathy')  // v4 shape check");
  try {
    const w = await ops.getPersonWorkload("Kathy");
    const summary = {
      person: w.person,
      ownedProjects: {
        inProgress: w.ownedProjects?.inProgress?.length ?? "MISSING",
        awaitingClient: w.ownedProjects?.awaitingClient?.length ?? "MISSING",
        blocked: w.ownedProjects?.blocked?.length ?? "MISSING",
        onHold: w.ownedProjects?.onHold?.length ?? "MISSING",
        completed: w.ownedProjects?.completed?.length ?? "MISSING",
      },
      weekItems: {
        overdue: w.weekItems?.overdue?.length ?? "MISSING",
        thisWeek: w.weekItems?.thisWeek?.length ?? "MISSING",
        nextWeek: w.weekItems?.nextWeek?.length ?? "MISSING",
        later: w.weekItems?.later?.length ?? "MISSING",
      },
      flags: {
        contractExpired: w.flags?.contractExpired?.length ?? "MISSING",
        retainerRenewalDue: w.flags?.retainerRenewalDue?.length ?? "MISSING",
      },
      totalProjects: w.totalProjects,
      totalActiveWeekItems: w.totalActiveWeekItems,
    };
    console.log(JSON.stringify(summary, null, 2));

    const requiredOwnedKeys = ["inProgress", "awaitingClient", "blocked", "onHold", "completed"] as const;
    for (const k of requiredOwnedKeys) {
      if (Array.isArray((w.ownedProjects as Record<string, unknown>)?.[k])) {
        pass(`ownedProjects.${k} is array`);
      } else {
        fail(`ownedProjects.${k} is array`, `got ${typeof (w.ownedProjects as Record<string, unknown>)?.[k]}`);
      }
    }

    const requiredWeekKeys = ["overdue", "thisWeek", "nextWeek", "later"] as const;
    for (const k of requiredWeekKeys) {
      if (Array.isArray((w.weekItems as Record<string, unknown>)?.[k])) {
        pass(`weekItems.${k} is array`);
      } else {
        fail(`weekItems.${k} is array`, `got ${typeof (w.weekItems as Record<string, unknown>)?.[k]}`);
      }
    }

    if (Array.isArray(w.flags?.contractExpired)) pass("flags.contractExpired is array");
    else fail("flags.contractExpired is array", `got ${typeof w.flags?.contractExpired}`);

    if (Array.isArray(w.flags?.retainerRenewalDue)) pass("flags.retainerRenewalDue is array");
    else fail("flags.retainerRenewalDue is array", `got ${typeof w.flags?.retainerRenewalDue}`);

    if (typeof w.totalProjects === "number") pass("totalProjects is number", `${w.totalProjects}`);
    else fail("totalProjects is number", `got ${typeof w.totalProjects}`);

    if (typeof w.totalActiveWeekItems === "number") pass("totalActiveWeekItems is number", `${w.totalActiveWeekItems}`);
    else fail("totalActiveWeekItems is number", `got ${typeof w.totalActiveWeekItems}`);
  } catch (err) {
    errors.push({ fn: "getPersonWorkload", err });
    fail("getPersonWorkload threw", (err as Error).message);
  }

  // ── 7. findUpdates + getUpdateChain ───────────────────
  section("7. findUpdates({ clientSlug: 'convergix', limit: 10 })");
  try {
    const rows = await ops.findUpdates({ clientSlug: "convergix", limit: 10 });
    console.log(`Returned ${rows.length} audit rows`);
    if (rows.length > 0) {
      const r = rows[0];
      console.log("  First row:", JSON.stringify({
        id: r.id,
        updateType: r.updateType,
        updatedAt: r.createdAt?.toISOString() ?? null,
        batchId: r.batchId,
        triggeredByUpdateId: r.triggeredByUpdateId,
      }, null, 2));
      const required = ["id", "updateType", "batchId", "triggeredByUpdateId"] as const;
      for (const k of required) {
        if (k in r) pass(`row has field '${k}'`);
        else fail(`row has field '${k}'`, "missing");
      }
      if ("createdAt" in r) pass("row has field 'createdAt' (updatedAt in prompt == createdAt in type)");
      else fail("row has field 'createdAt'", "missing");

      // Try getUpdateChain on first row with triggeredByUpdateId, if any.
      const rowWithParent = rows.find((x) => x.triggeredByUpdateId);
      if (rowWithParent) {
        section(`7b. getUpdateChain('${rowWithParent.id}')  // has triggeredByUpdateId`);
        const chain = await ops.getUpdateChain(rowWithParent.id);
        console.log(JSON.stringify({
          rootId: chain.root?.id ?? null,
          rootType: chain.root?.updateType ?? null,
          chainLength: chain.chain.length,
        }, null, 2));
        if (chain.root !== null) pass("getUpdateChain returned non-null root");
        else fail("getUpdateChain returned non-null root", "root was null");
        if (chain.chain.length >= 1) pass("getUpdateChain.chain >= 1", `len=${chain.chain.length}`);
        else fail("getUpdateChain.chain >= 1", `len=${chain.chain.length}`);
      } else {
        console.log("  (no rows had triggeredByUpdateId — skipping getUpdateChain subcheck)");
      }
    } else {
      console.log("  (no Convergix audit rows — skipping field checks)");
    }
  } catch (err) {
    errors.push({ fn: "findUpdates/getUpdateChain", err });
    fail("findUpdates threw", (err as Error).message);
  }

  // ── Summary ────────────────────────────────────────────
  console.log("");
  console.log("=".repeat(72));
  const pCount = results.filter((r) => r.kind === "pass").length;
  const fCount = results.filter((r) => r.kind === "fail").length;
  console.log(`SUMMARY: ${pCount} pass / ${fCount} fail${errors.length ? ` / ${errors.length} throw(s)` : ""}`);
  console.log("=".repeat(72));
  if (errors.length > 0) {
    console.log("");
    console.log("Errors caught:");
    for (const e of errors) {
      console.log(`  [${e.fn}] ${(e.err as Error).message}`);
      if ((e.err as Error).stack) {
        console.log(`    ${(e.err as Error).stack?.split("\n").slice(1, 4).join("\n    ")}`);
      }
    }
  }

  process.exit(fCount > 0 || errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL: main() threw unhandled:", err);
  process.exit(1);
});
