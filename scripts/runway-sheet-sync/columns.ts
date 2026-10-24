/**
 * The schedule sheet's column contract, Appendix D: column letters as
 * zero-based indexes, the header labels they must carry, and the live range.
 */

export const COL = { B: 1, C: 2, D: 3, E: 4, F: 5, H: 7, I: 8, J: 9, K: 10 } as const;

/** Expected column-header labels, Appendix D §D.2. Drift raises a flag. */
export const EXPECTED_HEADERS: [number, string][] = [
  [COL.C, "TASKS"],
  [COL.E, "START DATE"],
  [COL.F, "DUE DATE"],
  [COL.H, "PREDECESSOR"],
  [COL.I, "LAG"],
  [COL.J, "RESOURCE"],
  [COL.K, "STATUS"],
];

/** Live reads use the same tab and range the fixtures were exported from. */
export const LIVE_RANGE = "Task Tracker & Gantt Chart!A1:N";
