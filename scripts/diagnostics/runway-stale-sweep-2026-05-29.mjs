#!/usr/bin/env node
/**
 * Stale items sweep — 2026-05-29
 *
 * Pure read-only analysis against the prod snapshot at data/runway-snapshot.json.
 * Surfaces:
 *   A. WIs that should be in-progress but are still scheduled (startDate <= today, endDate >= today)
 *   B. WIs overdue: in-progress or scheduled with endDate < today
 *   C. Projects with stale status — all WIs completed but project status != completed
 *   D. Projects with status "in-production" but every child WI is completed
 *   E. WIs with status="blocked" but no waitingOn / no notes
 *   F. Past-completion projects with WIs still in-progress (cascade gap)
 *
 * Does NOT write anything. Outputs a markdown report for operator triage.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const TODAY = "2026-05-29";
const SNAPSHOT_PATH = resolve(process.cwd(), "data/runway-snapshot.json");
const OUT_PATH = resolve(process.cwd(), "docs/tmp/stale-sweep-2026-05-29.md");

const raw = readFileSync(SNAPSHOT_PATH, "utf8");
const data = JSON.parse(raw).tables;
const clientsById = new Map(data.clients.map((c) => [c.id, c]));
const projectsById = new Map(data.projects.map((p) => [p.id, p]));

const lines = [];
const log = (s = "") => lines.push(s);

log(`# Stale Items Sweep — ${TODAY}`);
log();
log(`Read-only analysis against prod snapshot pulled at apply time.`);
log(`Clients: ${data.clients.length} | Projects: ${data.projects.length} | WIs: ${data.weekItems.length} | Pipeline: ${data.pipelineItems.length}`);
log();

// ── Bucket A: WIs that should be in-progress but are still scheduled ──
log(`## A. Scheduled WIs that overlap today (auto-promote candidates)`);
log();
log(`Rule: status="scheduled" AND startDate <= ${TODAY} AND endDate >= ${TODAY}.`);
log(`These should be in-progress per #62 auto-promote logic. Each entry is also a candidate WI to manually flip if engineering isn't shipped yet.`);
log();
const bucketA = data.weekItems.filter(
  (w) => w.status === "scheduled" && w.startDate && w.endDate && w.startDate <= TODAY && w.endDate >= TODAY,
);
if (bucketA.length === 0) {
  log(`_None._`);
} else {
  log(`| Client | Project | WI | Dates |`);
  log(`|---|---|---|---|`);
  for (const w of bucketA) {
    const proj = projectsById.get(w.projectId);
    const client = clientsById.get(w.clientId);
    log(`| ${client?.name ?? "?"} | ${proj?.name ?? "?"} | ${w.title} | ${w.startDate} → ${w.endDate} |`);
  }
}
log();

// ── Bucket B: Overdue WIs ──
log(`## B. Overdue WIs (endDate before today, not terminal)`);
log();
log(`Rule: status in {scheduled, in-progress, blocked, at-risk} AND endDate < ${TODAY}.`);
log(`These are past their end-date but haven't been closed or extended.`);
log();
const bucketB = data.weekItems.filter(
  (w) =>
    ["scheduled", "in-progress", "blocked", "at-risk"].includes(w.status) &&
    w.endDate && w.endDate < TODAY,
);
if (bucketB.length === 0) {
  log(`_None._`);
} else {
  log(`| Client | Project | WI | endDate | Status | Days overdue |`);
  log(`|---|---|---|---|---|---|`);
  for (const w of bucketB.sort((a, b) => (a.endDate || "").localeCompare(b.endDate || ""))) {
    const proj = projectsById.get(w.projectId);
    const client = clientsById.get(w.clientId);
    const daysOverdue = Math.round((new Date(TODAY) - new Date(w.endDate)) / (1000 * 60 * 60 * 24));
    log(`| ${client?.name ?? "?"} | ${proj?.name ?? "?"} | ${w.title} | ${w.endDate} | ${w.status} | ${daysOverdue} |`);
  }
}
log();

// ── Bucket C: Projects with stale status — all WIs completed but project not completed ──
log(`## C. Projects with stale status (all WIs done but project not completed)`);
log();
log(`Rule: project status != "completed" AND has at least 1 WI AND every WI status === "completed".`);
log(`Caught the "Big Win Template" L2 case earlier — flagging for a status cleanup pass.`);
log();
const bucketC = [];
for (const p of data.projects) {
  if (p.status === "completed") continue;
  const wis = data.weekItems.filter((w) => w.projectId === p.id);
  if (wis.length === 0) continue;
  const allDone = wis.every((w) => w.status === "completed");
  if (allDone) bucketC.push({ project: p, wiCount: wis.length });
}
if (bucketC.length === 0) {
  log(`_None._`);
} else {
  log(`| Client | Project | Current status | WI count |`);
  log(`|---|---|---|---|`);
  for (const { project, wiCount } of bucketC) {
    const client = clientsById.get(project.clientId);
    log(`| ${client?.name ?? "?"} | ${project.name} | ${project.status} | ${wiCount} |`);
  }
}
log();

// ── Bucket D: Blocked WIs without explicit blocker context ──
log(`## D. Blocked WIs without clear blocker context`);
log();
log(`Rule: status="blocked" AND notes are missing or under 30 chars (likely no blocker explanation).`);
log(`Helps surface "blocked but why?" entries that drift forever.`);
log();
const bucketD = data.weekItems.filter(
  (w) => w.status === "blocked" && (!w.notes || w.notes.length < 30),
);
if (bucketD.length === 0) {
  log(`_None._`);
} else {
  log(`| Client | Project | WI | Notes length |`);
  log(`|---|---|---|---|`);
  for (const w of bucketD) {
    const proj = projectsById.get(w.projectId);
    const client = clientsById.get(w.clientId);
    log(`| ${client?.name ?? "?"} | ${proj?.name ?? "?"} | ${w.title} | ${w.notes?.length ?? 0} |`);
  }
}
log();

// ── Bucket E: Completed projects with in-progress WIs underneath (cascade gap) ──
log(`## E. Completed projects with non-terminal WIs underneath`);
log();
log(`Rule: project status="completed" AND has WIs with status NOT in {completed, canceled}.`);
log(`Indicates cascade gap — project marked done while child work is still open.`);
log();
const bucketE = [];
for (const p of data.projects.filter((p) => p.status === "completed")) {
  const stragglers = data.weekItems.filter(
    (w) => w.projectId === p.id && !["completed", "canceled"].includes(w.status),
  );
  if (stragglers.length > 0) bucketE.push({ project: p, stragglers });
}
if (bucketE.length === 0) {
  log(`_None._`);
} else {
  log(`| Client | Completed project | Straggler WI | Status |`);
  log(`|---|---|---|---|`);
  for (const { project, stragglers } of bucketE) {
    const client = clientsById.get(project.clientId);
    for (const w of stragglers) {
      log(`| ${client?.name ?? "?"} | ${project.name} | ${w.title} | ${w.status} |`);
    }
  }
}
log();

// ── Bucket F: in-progress projects with NO open WIs ──
log(`## F. Active projects (in-production / awaiting-client) with zero open WIs`);
log();
log(`Rule: status in {in-production, awaiting-client} AND every WI under it is in a terminal state OR there are zero WIs.`);
log(`Suggests project is awaiting next steps or should be reclassified.`);
log();
const bucketF = [];
for (const p of data.projects.filter((p) =>
  ["in-production", "awaiting-client"].includes(p.status),
)) {
  // skip retainer wrappers with L2 children (they're containers, not direct WI homes)
  const l2Children = data.projects.filter((x) => x.parentProjectId === p.id);
  if (p.engagementType === "retainer" && l2Children.length > 0) continue;
  const wis = data.weekItems.filter((w) => w.projectId === p.id);
  const openWis = wis.filter(
    (w) => !["completed", "canceled"].includes(w.status),
  );
  if (openWis.length === 0) {
    bucketF.push({ project: p, totalWis: wis.length });
  }
}
if (bucketF.length === 0) {
  log(`_None._`);
} else {
  log(`| Client | Project | Status | Total WIs | Open WIs |`);
  log(`|---|---|---|---|---|`);
  for (const { project, totalWis } of bucketF) {
    const client = clientsById.get(project.clientId);
    log(`| ${client?.name ?? "?"} | ${project.name} | ${project.status} | ${totalWis} | 0 |`);
  }
}
log();

// ── Summary ──
log(`## Summary`);
log();
log(`| Bucket | Count |`);
log(`|---|---|`);
log(`| A. Auto-promote candidates (scheduled overlapping today) | ${bucketA.length} |`);
log(`| B. Overdue WIs (past endDate, not terminal) | ${bucketB.length} |`);
log(`| C. Stale-status projects (all WIs done, project still open) | ${bucketC.length} |`);
log(`| D. Blocked WIs without context | ${bucketD.length} |`);
log(`| E. Completed projects with open WIs (cascade gap) | ${bucketE.length} |`);
log(`| F. Active projects with zero open WIs | ${bucketF.length} |`);
log();

if (!existsSync(dirname(OUT_PATH))) mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, lines.join("\n"));
console.log(`Report written to: ${OUT_PATH}`);
console.log();
console.log("=== HEADLINE COUNTS ===");
console.log(`A. Auto-promote candidates: ${bucketA.length}`);
console.log(`B. Overdue WIs: ${bucketB.length}`);
console.log(`C. Stale-status projects: ${bucketC.length}`);
console.log(`D. Blocked w/o context: ${bucketD.length}`);
console.log(`E. Completed projects w/ open WIs: ${bucketE.length}`);
console.log(`F. Active projects w/ zero open WIs: ${bucketF.length}`);
