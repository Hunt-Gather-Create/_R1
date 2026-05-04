/**
 * share-orchestrator.ts — thin re-export of generateGanttShare for MCP/Slack tools.
 *
 * WHY THIS FILE EXISTS:
 * GanttTemplate.tsx previously imported react-dom/server via an ES `import`
 * statement, which Turbopack's static analyzer flagged in App Router module
 * graphs. That import was changed to a CommonJS `require()` call (which
 * Turbopack does NOT trace statically), so server.ts is now safe to import
 * from any App Route module graph.
 *
 * This file exists as the import point for MCP and Slack bot tools so that:
 * 1. The import path is stable and testable — tests mock this module by path.
 * 2. If the Turbopack constraint ever returns (e.g. after a Next.js upgrade
 *    that starts tracing require() calls), the fallback pattern is in git
 *    history and this file is the only change point.
 *
 * Keep in sync with server.ts if GenerateGanttShare* types change.
 */

export type { GenerateGanttShareInput, GenerateGanttShareResult } from "./server";
export { generateGanttShare } from "./server";
