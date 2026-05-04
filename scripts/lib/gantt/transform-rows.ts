/**
 * Re-export from src/ — pure row transforms live in src/lib/runway/gantt/transform-rows.ts.
 * This shim keeps the CLI entry (scripts/runway-gantt.tsx) import paths unchanged.
 */
export {
  computeAxis,
  formatDateRange,
  transformRows,
} from "../../../src/lib/runway/gantt/transform-rows";
