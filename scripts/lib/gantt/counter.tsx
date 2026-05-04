/**
 * Re-export from src/ — counter lives in src/lib/runway/gantt/counter.tsx.
 * This shim keeps the CLI entry (scripts/runway-gantt.tsx) import paths unchanged.
 */
export {
  formatCounterConsole,
  formatCounterMarkup,
  formatHeadline,
  formatSeverityLine,
  summarize,
} from "../../../src/lib/runway/gantt/counter";
