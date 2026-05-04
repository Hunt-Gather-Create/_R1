/**
 * Re-export from src/ — GanttTemplate lives in src/lib/runway/gantt/GanttTemplate.tsx.
 * This shim keeps the CLI entry (scripts/runway-gantt.tsx) import paths unchanged.
 */
export {
  GanttTemplate,
  RundownTemplate,
  computeBarGeometry,
  computeTodayPosition,
  renderClientRundown,
  renderGantt,
} from "../../../src/lib/runway/gantt/GanttTemplate";
