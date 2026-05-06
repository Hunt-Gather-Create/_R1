"use client";

/**
 * Thin dynamic wrapper around GanttSection for use inside client components.
 *
 * GanttTemplate.tsx imports react-dom/server (renderToStaticMarkup) and
 * themes.ts imports Node's `fs` module — both are server-only. Importing them
 * directly inside a "use client" component causes a build error.
 *
 * next/dynamic with ssr:false defers the import to the browser bundle, keeping
 * the server-only modules out of the client graph.
 *
 * This wrapper is ONLY for the dark-account-view embed. The CLI / share-route
 * paths continue to import GanttSection directly (server context, no issue).
 */

import dynamic from "next/dynamic";
import type { GanttData } from "@/lib/runway/gantt/types";
import type { Theme } from "@/lib/runway/gantt/types";

const GanttSectionDynamic = dynamic(
  () =>
    import("@/lib/runway/gantt/GanttTemplate").then((m) => ({
      default: m.GanttSection,
    })),
  { ssr: false }
);

export function GanttSectionClient({ data, theme }: { data: GanttData; theme: Theme }) {
  return <GanttSectionDynamic data={data} theme={theme} />;
}
