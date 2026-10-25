/**
 * Which database a run opens, and whether it may write. A run without --apply
 * opens prod read-only and writes nothing. An --apply run opens prod, or
 * runway-staging with --target staging, and is the only run that writes.
 */
export interface RunDatabase {
  staging: boolean;
  readOnly: boolean;
}

export function runDatabase(argv: readonly string[], target: string | undefined): RunDatabase {
  const doApply = argv.includes("--apply") && !argv.includes("--dry-run");
  return doApply ? { staging: target === "staging", readOnly: false } : { staging: false, readOnly: true };
}
