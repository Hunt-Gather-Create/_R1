/**
 * Sheet parser — fixture grid → ParsedSheet (meta, classified rows, leaf
 * tasks with derived fields, variance flags vs the Appendix D contract).
 */
import { classifyRows, LEAF_PREFIX } from "./classify";
import { composeNotes, deriveCategory, deriveStatus, disambiguateTitles } from "./derive";
import { getMondayIso, isParseableDate, parseSheetDate } from "./parse-dates";
import type { LeafTask, ParsedSheet, SheetConfig, SheetFixture, SheetMeta } from "./types";

const COL = { B: 1, C: 2, D: 3, E: 4, F: 5, H: 7, I: 8, J: 9, K: 10 } as const;

const CODE_RE = /\b[A-Z]{2,4}-\d{4}(?:-\d{2})?\b/;

/** Expected column-header labels (Appendix D §D.2) — drift raises a flag. */
const EXPECTED_HEADERS: [number, string][] = [
  [COL.C, "TASKS"],
  [COL.E, "START DATE"],
  [COL.F, "DUE DATE"],
  [COL.H, "PREDECESSOR"],
  [COL.I, "LAG"],
  [COL.J, "RESOURCE"],
  [COL.K, "STATUS"],
];

function cell(row: (string | undefined)[] | undefined, idx: number): string {
  return String(row?.[idx] ?? "");
}

function parseBanner(values: (string | undefined)[][], config: SheetConfig): Omit<SheetMeta, "headerRowNumber"> {
  const b = (n: number) => cell(values[n - 1], COL.B).trim();

  let bannerVariant: SheetMeta["bannerVariant"] = "unknown";
  let engagementTitle: string | null = null;

  if (b(1).toUpperCase() === "CIVILIZATION") {
    // Variant A: row 3 "Client | Project Plan", row 5 "Engagement title | CODE".
    bannerVariant = "A";
    const row5 = b(5);
    engagementTitle = row5 ? row5.split("|")[0].trim() : null;
  } else if (b(1).startsWith("Client Name:") || b(2).startsWith("Project:")) {
    // Variant B: row 1 "Client Name: X", row 2 "Project: Y".
    bannerVariant = "B";
    const proj = b(2).replace(/^Project:\s*/, "").trim();
    engagementTitle = proj || null;
  }

  // Code can appear anywhere in the top banner rows — scan rows 1-8, col B.
  let bannerCode: string | null = null;
  for (let n = 1; n <= 8 && !bannerCode; n++) {
    const m = CODE_RE.exec(b(n));
    if (m) bannerCode = m[0];
  }

  return {
    bannerVariant,
    engagementTitle,
    bannerCode,
    codeDrift: bannerCode !== null && bannerCode !== config.engagementCode,
  };
}

export function parseSheet(fixture: SheetFixture, config: SheetConfig): ParsedSheet {
  const { rows, headerRowNumber } = classifyRows(fixture.values);
  const flags: string[] = [];

  const meta: SheetMeta = {
    ...parseBanner(fixture.values, config),
    headerRowNumber,
  };

  if (headerRowNumber === -1) {
    flags.push("CONTRACT: column-header row (✔ | TASKS) not found — sheet unparseable");
    return { config, meta, rows, leafTasks: [], flags };
  }

  if (meta.bannerVariant === "unknown") {
    flags.push("SHAPE: banner layout matches neither variant A (CIVILIZATION) nor B (Client Name:)");
  }
  if (meta.bannerVariant === "B") {
    flags.push("SHAPE: banner variant B (Client Name:/Project: layout) — Appendix D documents variant A");
  }
  if (headerRowNumber !== 10) {
    flags.push(`SHAPE: column-header at row ${headerRowNumber} (Appendix D expects row 10)`);
  }
  if (meta.codeDrift) {
    flags.push(
      `CODE-DRIFT (R7): banner code ${meta.bannerCode} != config engagement code ${config.engagementCode}`
    );
  }

  const headerRow = fixture.values[headerRowNumber - 1] ?? [];
  for (const [idx, expected] of EXPECTED_HEADERS) {
    const actual = cell(headerRow, idx).trim().toUpperCase();
    if (actual !== expected) {
      flags.push(`CONTRACT: col ${String.fromCharCode(65 + idx)} header "${actual}" != "${expected}"`);
    }
  }

  const leafTasks: LeafTask[] = [];
  let currentSection: string | null = null;
  let sortOrder = 0;
  let sawUnnumberedLeaf = false;
  let sawUnparseableDate = false;

  for (const r of rows) {
    if (r.type === "section-header" || r.type === "rollup") {
      currentSection = cell(r.raw, COL.C).trim();
      continue;
    }
    if (r.type !== "leaf" && r.type !== "leaf-unnumbered") continue;

    const rawLabel = cell(r.raw, COL.C);
    const prefixMatch = LEAF_PREFIX.exec(rawLabel);
    const taskNo = prefixMatch ? prefixMatch[1] : null;
    const title = rawLabel.replace(LEAF_PREFIX, "").trim();

    for (const col of [COL.E, COL.F]) {
      if (!isParseableDate(cell(r.raw, col))) {
        sawUnparseableDate = true;
        flags.push(
          `DATA: row ${r.rowNumber} col ${col === COL.E ? "E" : "F"} unparseable date "${cell(r.raw, col)}"`
        );
      }
    }

    const startDate = parseSheetDate(cell(r.raw, COL.E));
    const endDate = parseSheetDate(cell(r.raw, COL.F));
    const completed = cell(r.raw, COL.B).trim().toUpperCase() === "TRUE";
    const predecessorRaw = cell(r.raw, COL.H).trim();
    const lagRaw = cell(r.raw, COL.I).trim();
    const resource = cell(r.raw, COL.J).trim() || null;
    const priority = cell(r.raw, COL.D).trim() || null;

    if (r.type === "leaf-unnumbered") sawUnnumberedLeaf = true;

    const notesParts = {
      taskNo,
      resource,
      predecessorRow: predecessorRaw !== "" && /^\d+$/.test(predecessorRaw) ? Number(predecessorRaw) : null,
      lag: lagRaw !== "" && /^-?\d+$/.test(lagRaw) ? Number(lagRaw) : null,
      priority,
    };
    const { notes, truncated } = composeNotes(notesParts);

    leafTasks.push({
      rowNumber: r.rowNumber,
      taskNo,
      rawLabel,
      title,
      resolvedTitle: title,
      startDate,
      endDate,
      weekOf: startDate ? getMondayIso(startDate) : null,
      completed,
      derivedStatus: deriveStatus(completed),
      category: deriveCategory(title, currentSection),
      section: currentSection,
      priority,
      predecessorRow: notesParts.predecessorRow,
      lag: notesParts.lag,
      resource,
      notes,
      notesTruncated: truncated,
      sortOrder: sortOrder++,
    });

    const kStatus = cell(r.raw, COL.K).trim();
    if (kStatus !== "") {
      flags.push(`DATA: row ${r.rowNumber} col K carries status text "${kStatus}" (contract says derive, not read)`);
    }
  }

  if (sawUnnumberedLeaf) {
    flags.push("SHAPE: unnumbered leaf task(s) present — identity falls back to title key (§2.9 hazard)");
  }
  if (leafTasks.length === 0) {
    flags.push("SHAPE: zero leaf tasks — sheet appears to be an unfilled template");
  }
  if (sawUnparseableDate) {
    flags.push("DATA: one or more unparseable dates — rows carried with null dates, no weekOf derivable");
  }

  const disambiguated = disambiguateTitles(leafTasks);
  if (disambiguated > 0) {
    flags.push(
      `IDEMPOTENCY (§2.7): ${disambiguated} leaf task(s) share (title, weekOf) — resolvedTitle suffixed to avoid create-side dedupe`
    );
  }

  return { config, meta, rows, leafTasks, flags };
}
