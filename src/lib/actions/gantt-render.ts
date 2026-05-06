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
 * This file wraps generateGanttShare in an auth gate and re-exports its
 * types from the "use server" bundle boundary, making the function importable
 * from API route handlers without triggering the Turbopack module-condition
 * error.
 *
 * AUTH GATE (defense-in-depth):
 * Real callers (API route handlers, MCP tools, CLI) authenticate at their own
 * layer before invoking generateGanttShare. However, because this module is
 * marked "use server", any client component that imports it would expose
 * generateGanttShare as a public RPC endpoint accepting unauthenticated calls.
 * The wrapper below requires a valid WorkOS session before delegating, so a
 * client-component-invoked server action without auth will throw rather than
 * generate a hosted share link or read Runway data.
 */
import { getCurrentUser } from "@/lib/auth";
import {
  generateGanttShare as _generateGanttShare,
  type GenerateGanttShareInput,
  type GenerateGanttShareResult,
} from "@/lib/runway/gantt/server";

export type { GenerateGanttShareInput, GenerateGanttShareResult };

/**
 * Server-action wrapper around generateGanttShare. Requires a valid WorkOS
 * session cookie before delegating to the underlying generator. Throws if no
 * authentication context is present.
 *
 * Route handlers, MCP tools, and CLI paths should continue to import
 * `generateGanttShare` directly from `@/lib/runway/gantt/server` and apply
 * their own bearer-token / shell-context auth — this wrapper exists to
 * protect the server-action call surface that Next.js exposes to client
 * components.
 */
export async function generateGanttShare(
  input: GenerateGanttShareInput,
): Promise<GenerateGanttShareResult> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error(
      "gantt-render server action invoked without authentication context",
    );
  }
  return _generateGanttShare(input);
}
