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
 * Light-internal theme: neutral Tailwind blue for active, muted grays for
 * completed/canceled, attention colors for at-risk/blocked.
 */
const LIGHT_INTERNAL: Record<GanttStatus, StatusColorEntry> = {
  active: {
    bar: "#3b82f6",
    legendBg: "#3b82f6",
  },
  scheduled: {
    bar: "#eff6ff",
    barBorder: "1px dashed #93c5fd",
    legendBg: "#eff6ff",
    legendBorder: "1px dashed #93c5fd",
    barExtra: "box-sizing: border-box;",
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
    bar: "#86efac",
    barBorder: "1px solid #4ade80",
    legendBg: "#86efac",
    legendBorder: "1px solid #4ade80",
    barExtra: "box-sizing: border-box;",
    rowText: "#475569",
  },
  canceled: {
    // Diagonal strikethrough overlay on gray
    bar: "linear-gradient(to top right, transparent calc(50% - 1px), #64748b calc(50% - 1px), #64748b calc(50% + 1px), transparent calc(50% + 1px)), #cbd5e1",
    legendBg: "linear-gradient(to top right, transparent calc(50% - 1px), #64748b calc(50% - 1px), #64748b calc(50% + 1px), transparent calc(50% + 1px)), #cbd5e1",
    rowText: "#94a3b8",
  },
};

/**
 * Light-branded theme: Civilization brand blue #0E5DFF for active,
 * slightly softer pastels for completed/scheduled.
 */
const LIGHT_BRANDED: Record<GanttStatus, StatusColorEntry> = {
  active: {
    bar: "#0E5DFF",
    legendBg: "#0E5DFF",
  },
  scheduled: {
    bar: "#F9FAFB",
    barBorder: "1px dashed #D1D5DB",
    legendBg: "#F9FAFB",
    legendBorder: "1px dashed #D1D5DB",
    barExtra: "box-sizing: border-box;",
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
    bar: "#10B981",
    barBorder: "1px solid #059669",
    legendBg: "#10B981",
    legendBorder: "1px solid #059669",
    barExtra: "box-sizing: border-box; opacity: 0.6;",
    rowText: "#333333",
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
 *   scheduled: bg-slate-500/40 + border dashed border-slate-500
 *   at-risk:   bg-amber-500/60
 *   blocked:   bg-red-500/60
 *   completed: bg-emerald-500/40 + border border-emerald-400 + opacity 0.7
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
