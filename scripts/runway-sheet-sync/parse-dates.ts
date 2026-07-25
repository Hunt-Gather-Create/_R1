/**
 * Explicit locale date parsing for sheet cols E/F.
 *
 * Two observed formats across the 4-sheet set (shape variance found 2026-07-24):
 *   - "22-Jun-2026" / "2-Jul-2026"  (d-MMM-yyyy — LPPC + Soundly)
 *   - "7/13/2026"                    (M/D/YYYY — BP ITEP)
 *
 * No `new Date(string)` parsing — silent-corruption class (§2.3).
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const D_MMM_YYYY = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/;
const M_D_YYYY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a sheet date cell to ISO "yyyy-mm-dd".
 * Returns null for empty cells. Returns null for unparseable non-empty
 * values too — callers must flag those separately via isParseableDate.
 */
export function parseSheetDate(raw: string | undefined | null): string | null {
  const v = String(raw ?? "").trim();
  if (v === "") return null;

  const dmmm = D_MMM_YYYY.exec(v);
  if (dmmm) {
    const month = MONTHS[dmmm[2].toLowerCase()];
    if (!month) return null;
    return toIso(Number(dmmm[3]), month, Number(dmmm[1]));
  }

  const mdy = M_D_YYYY.exec(v);
  if (mdy) {
    return toIso(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]));
  }

  return null;
}

/** True when the cell is empty OR parses cleanly — false = variance flag. */
export function isParseableDate(raw: string | undefined | null): boolean {
  const v = String(raw ?? "").trim();
  return v === "" || parseSheetDate(v) !== null;
}

/**
 * Monday (ISO date) of the week containing the given ISO date.
 * Mirrors the private getMonday in src/lib/runway/operations-writes-week.ts:74
 * exactly, so emitted weekOf matches what createWeekItem would derive.
 */
export function getMondayIso(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
