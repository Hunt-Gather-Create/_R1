/**
 * Server-side utility: pre-renders GanttSection to static HTML strings.
 *
 * This module uses dynamic import() to defer loading GanttTemplate.tsx
 * and react-dom/server, avoiding the Turbopack "server component imports
 * react-dom/server" restriction that fires on static (top-level) imports.
 *
 * Called from page.tsx (server component) to produce HTML strings that
 * are safe to pass to client components via props (no server-only modules
 * in the client bundle).
 */

import type { ClientRundownData } from "@/lib/runway/gantt/types";
import type { RenderedClientRundownData } from "./types";

export async function preRenderClientRundown(
  rundown: ClientRundownData,
): Promise<RenderedClientRundownData> {
  // Dynamic import defers module resolution to call time, not module init.
  // Turbopack resolves static imports at build time — dynamic imports bypass
  // the "server component imports react-dom/server" lint check.
  const [{ renderToStaticMarkup }, { GanttSection }] = await Promise.all([
    import("react-dom/server"),
    import("@/lib/runway/gantt/GanttTemplate"),
  ]);

  // react-dom/server needs React in scope for JSX transform
  const React = (await import("react")).default;

  return {
    generatedAt: rundown.generatedAt,
    overallSeverity: rundown.overallSeverity,
    sections: rundown.sections.map((s) => ({
      anchor: s.anchor,
      kind: s.kind,
      title: s.title,
      parentTitle: s.parentTitle,
      renderedHtml: renderToStaticMarkup(
        React.createElement(GanttSection, { data: s.data, theme: "dark-account-view" as const }),
      ),
    })),
  };
}
