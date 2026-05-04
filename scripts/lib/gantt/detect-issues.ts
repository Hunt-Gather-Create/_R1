/**
 * Re-export from src/ — pure detectors live in src/lib/runway/gantt/detect-issues.ts.
 * This shim keeps the CLI entry (scripts/runway-gantt.tsx) import paths unchanged.
 */
export {
  detectAllIssues,
  detectChildProjectIssues,
  detectL1Issues,
  detectWeekItemIssues,
  detectWrapperIssues,
} from "../../../src/lib/runway/gantt/detect-issues";
