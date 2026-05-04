"use server";
/**
 * gantt-render.ts — Server Action wrapper for generateGanttShare.
 *
 * WHY THIS FILE EXISTS:
 * server.ts (gantt module) imports GanttTemplate.tsx → react-dom/server.
 * Next.js 16 + Turbopack blocks react-dom/server in App Router route module
 * graphs. However, "use server" files are bundled separately in Next.js and
 * bypass the react-server module-condition check that rejects react-dom/server
 * in regular route handlers.
 *
 * This file re-exports generateGanttShare and its types from the "use server"
 * bundle boundary, making the function importable from API route handlers
 * without triggering the Turbopack module-condition error.
 */

export {
  generateGanttShare,
  type GenerateGanttShareInput,
  type GenerateGanttShareResult,
} from "@/lib/runway/gantt/server";
