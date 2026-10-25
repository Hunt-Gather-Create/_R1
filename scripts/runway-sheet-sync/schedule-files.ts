/**
 * The schedule file name rule. A Drive spreadsheet is a schedule when its
 * name carries a version marker, and it belongs to the job whose number
 * starts its name.
 */

/** A Drive file as drive:search returns it. */
export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  parents?: string[];
}

/**
 * A job number is a prefix of letters and digits, a dash, four digits, then
 * any number of dash and two digit groups: ABC-2604, AB1-2601, ABC-2501-03-35.
 */
export const JOB_NUMBER = /^[A-Za-z0-9]+-\d{4}(?:-\d{2})*$/;

const VERSION_MARK = /(?:Schedule v|Project Plan v|Project-Plan-v)(\d+)/i;

/** The version number in a schedule file name, or null when the name is not a schedule. */
export function scheduleVersion(name: string): number | null {
  const m = name.match(VERSION_MARK);
  return m ? Number(m[1]) : null;
}

/**
 * True when the name starts with the job number as a whole token, so job
 * ABC-2604 never claims a file named for ABC-2604-02.
 */
export function startsWithJob(name: string, jobNumber: string): boolean {
  if (name.slice(0, jobNumber.length).toUpperCase() !== jobNumber.toUpperCase()) return false;
  const rest = name.slice(jobNumber.length);
  return rest === "" || /^(?:[^A-Za-z0-9-]|-(?!\d))/.test(rest);
}
