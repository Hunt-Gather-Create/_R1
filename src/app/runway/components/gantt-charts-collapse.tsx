/**
 * Shared collapse primitive for the Gantt Charts dark-theme surface.
 *
 * Extracted from rundown-content-rsc.tsx so the per-account section in
 * gantt-charts-section.tsx (a "use client" component) can reuse the same
 * chevron + rotation CSS without crossing the RSC ↔ client component
 * boundary in a way Next.js disallows. Server and client components can
 * both render these — no "use client" directive here, no client-only APIs.
 *
 * The CSS rule is global by selector (`details.gantt-charts-details > ...`).
 * Render `<GanttChartsChevronStyle />` ONCE in any subtree that contains
 * `<details className="gantt-charts-details ...">` blocks; the cascade
 * applies to every matching element in document order.
 *
 * Mirrors the Wave 4.1 `account-tier-details` pattern in
 * src/app/runway/components/account-tier/CollapsibleSection.tsx so the
 * light and dark themes behave identically: hidden default disclosure
 * triangle, custom `▶` rotated 90deg via the `[open]` attribute selector
 * with a 150ms ease-out transition.
 */

import * as React from "react";

export const GANTT_CHARTS_CHEVRON_CSS = `
  details.gantt-charts-details > summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  details.gantt-charts-details > summary::-webkit-details-marker {
    display: none;
  }
  details.gantt-charts-details > summary > .gantt-charts-chevron {
    display: inline-block;
    transition: transform 150ms ease-out;
    transform: rotate(0deg);
    font-size: 0.65rem;
    line-height: 1;
  }
  details.gantt-charts-details[open] > summary > .gantt-charts-chevron {
    transform: rotate(90deg);
  }
`;

export function GanttChartsChevronStyle(): React.JSX.Element {
  return <style>{GANTT_CHARTS_CHEVRON_CSS}</style>;
}

export function GanttChartsChevron(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="gantt-charts-chevron">
      ▶
    </span>
  );
}
