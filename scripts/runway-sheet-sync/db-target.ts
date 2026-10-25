/**
 * Which database a run opens. Only an --apply run may name prod; every other
 * run opens the runway-staging clone, whatever flags it carries, because a
 * --live dry run still writes ledger rows.
 */
export function opensStaging(argv: readonly string[], target: string | undefined): boolean {
  const doApply = argv.includes("--apply") && !argv.includes("--dry-run");
  return doApply ? target === "staging" : true;
}
