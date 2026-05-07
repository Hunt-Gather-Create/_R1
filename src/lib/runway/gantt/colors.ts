/**
 * Gantt status color tokens -- single source of truth for all 3 themes.
 *
 * dashboard-cleanup item 10: centralizing these prevents "hunt hex" when a
 * status color needs to change -- one edit here propagates to all themes.
 *
 * Themes:
 *   "light-internal"  -- internal team view (light background, Tailwind blue)
 *   "light-branded"   -- client-facing PDF (white/Civ brand blue #0E5DFF)
 *   "dark-account"    -- dark embed inside the dashboard (CSS module Tailwind)
 *
 * For dark-account the values are Tailwind utility strings consumed via
 * @apply in gantt-dark-embed.module.css. They are listed here for
 * documentation but are NOT interpolated into the CSS module (Tailwind's
 * @reference resolution requires static strings).
 *
 * Each status entry exposes:
 *   bar   -- bar background CSS (background property value)
 *   barBorder -- optional border CSS string (for scheduled, completed)
 *   milestone -- milestone/diamond background CSS
 *   legendBg  -- legend swatch background CSS
 *   legendBorder -- optional legend swatch border CSS
 */

export type GanttTheme = "light-internal" | "light-branded" | "dark-account";
export type GanttStatus = "active" | "scheduled" | "at-risk" | "blocked" | "completed" | "canceled";

export interface StatusColorEntry {
  /** CSS value for `background` on .bar and .milestone */
  bar: string;
  /** Optional CSS value for `border` on .bar and .milestone. Set when status uses border. */
  barBorder?: string;
  /** CSS value for `background` on .legend-swatch */
  legendBg: string;
  /** Optional CSS value for `border` on .legend-swatch */
  legendBorder?: string;
  /** Row text treatment for title/meta/dates */
  rowText?: string;
  /** Extra bar CSS (e.g. opacity, box-sizing) */
  barExtra?: string;
}

/**
 * Light-internal theme (dashboard-cleanup item 11 color scheme update):
 * - active: unchanged Tailwind blue
 * - scheduled: teal solid bar (#06b6d4 / cyan-500). Replaces pale dashed blue.
 *   Chosen: teal reads "upcoming/planned" without being warning-coded.
 * - completed: muted slate fill + lighter text. Replaces solid green.
 *   Distinguishable from canceled (which keeps strikethrough) and from active.
 * - canceled: unchanged diagonal strikethrough on gray
 */
const LIGHT_INTERNAL: Record<GanttStatus, StatusColorEntry> = {
  active: {
    bar: "#3b82f6",
    legendBg: "#3b82f6",
  },
  scheduled: {
    // QA tweak 2026-05-07: switched from teal (#06b6d4) to violet because
    // teal read as "blue cousin" of in-progress at small sizes. Violet sits
    // opposite blue on the wheel, so scheduled now reads distinctly as
    // "queued / not yet active" without warning-coding.
    bar: "#8b5cf6",
    legendBg: "#8b5cf6",
  },
  "at-risk": {
    bar: "#f59e0b",
    legendBg: "#f59e0b",
  },
  blocked: {
    bar: "#ef4444",
    legendBg: "#ef4444",
  },
  completed: {
    // item 11: muted gray fill -- "done and closed out", not competing with active
    bar: "#cbd5e1",
    barBorder: "1px solid #94a3b8",
    legendBg: "#cbd5e1",
    legendBorder: "1px solid #94a3b8",
    barExtra: "box-sizing: border-box;",
    rowText: "#94a3b8",
  },
  canceled: {
    // Diagonal strikethrough overlay on gray -- unchanged
    bar: "linear-gradient(to top right, transparent calc(50% - 1px), #64748b calc(50% - 1px), #64748b calc(50% + 1px), transparent calc(50% + 1px)), #cbd5e1",
    legendBg: "linear-gradient(to top right, transparent calc(50% - 1px), #64748b calc(50% - 1px), #64748b calc(50% + 1px), transparent calc(50% + 1px)), #cbd5e1",
    rowText: "#94a3b8",
  },
};

/**
 * Light-branded theme (dashboard-cleanup item 11 color scheme update):
 * - scheduled: teal #0891B2 (cyan-600 -- slightly deeper than internal for
 *   contrast against white branded bg). Replaces pale dashed gray.
 * - completed: muted slate -- matches internal theme semantics.
 * - canceled: unchanged flat gray
 */
const LIGHT_BRANDED: Record<GanttStatus, StatusColorEntry> = {
  active: {
    bar: "#0E5DFF",
    legendBg: "#0E5DFF",
  },
  scheduled: {
    // QA tweak 2026-05-07: violet replaces teal so scheduled doesn't read as
    // a "blue cousin" of in-progress (Civ brand blue #0E5DFF). Slightly
    // deeper than light-internal violet for contrast on white branded bg.
    bar: "#7c3aed",
    legendBg: "#7c3aed",
  },
  "at-risk": {
    bar: "#F59E0B",
    legendBg: "#F59E0B",
    barExtra: "opacity: 0.7;",
  },
  blocked: {
    bar: "#DC2626",
    legendBg: "#DC2626",
    barExtra: "opacity: 0.7;",
  },
  completed: {
    // item 11: muted gray -- "done", not competing with active Civ blue
    bar: "#CBD5E1",
    barBorder: "1px solid #94A3B8",
    legendBg: "#CBD5E1",
    legendBorder: "1px solid #94A3B8",
    barExtra: "box-sizing: border-box;",
    rowText: "#6B7280",
  },
  canceled: {
    bar: "#9CA3AF",
    legendBg: "#9CA3AF",
    rowText: "#9CA3AF",
  },
};

/**
 * Dark-account theme: color definitions as semantic identifiers.
 * The actual CSS lives in gantt-dark-embed.module.css (Tailwind @apply).
 * Listed here so refactors can reference canonical names and confirm parity
 * with the CSS module.
 *
 * Tailwind equivalents (for reference only -- NOT interpolated):
 *   active:    bg-blue-500/70
 *   scheduled: bg-violet-500/60     (QA 2026-05-07: was bg-cyan-500/60)
 *   at-risk:   bg-amber-500/60
 *   blocked:   bg-red-500/60
 *   completed: bg-slate-500/50 + border border-slate-400/60
 *   canceled:  bg-slate-600/30 + border border-slate-400/40
 */
const DARK_ACCOUNT: Record<GanttStatus, StatusColorEntry> = {
  active: { bar: "var(--gantt-dark-active)", legendBg: "var(--gantt-dark-active)" },
  scheduled: { bar: "var(--gantt-dark-scheduled)", legendBg: "var(--gantt-dark-scheduled)" },
  "at-risk": { bar: "var(--gantt-dark-at-risk)", legendBg: "var(--gantt-dark-at-risk)" },
  blocked: { bar: "var(--gantt-dark-blocked)", legendBg: "var(--gantt-dark-blocked)" },
  completed: { bar: "var(--gantt-dark-completed)", legendBg: "var(--gantt-dark-completed)" },
  canceled: { bar: "var(--gantt-dark-canceled)", legendBg: "var(--gantt-dark-canceled)" },
};

/**
 * Master color token map. Index by theme then by status to get CSS values.
 *
 * Usage (light themes -- GanttTemplate.tsx inline CSS):
 *   const c = GANTT_STATUS_COLORS["light-internal"].completed;
 *   `background: ${c.bar}; border: ${c.barBorder ?? "none"};`
 *
 * Usage (dark theme -- gantt-dark-embed.module.css):
 *   See DARK_ACCOUNT comments above. Colors applied via Tailwind @apply.
 */
export const GANTT_STATUS_COLORS: Record<GanttTheme, Record<GanttStatus, StatusColorEntry>> = {
  "light-internal": LIGHT_INTERNAL,
  "light-branded": LIGHT_BRANDED,
  "dark-account": DARK_ACCOUNT,
};

/**
 * Convenience helper -- returns the CSS string for the `background` rule of a
 * status bar, safe to interpolate directly into a CSS string template.
 */
export function barBg(theme: GanttTheme, status: GanttStatus): string {
  return GANTT_STATUS_COLORS[theme][status].bar;
}

/**
 * Returns the border CSS string for a status, or empty string if none.
 */
export function barBorder(theme: GanttTheme, status: GanttStatus): string {
  return GANTT_STATUS_COLORS[theme][status].barBorder ?? "";
}
