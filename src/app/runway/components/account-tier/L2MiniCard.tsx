/**
 * Track 4 Wave 4.1 — compressed mini-card for an L2 weekItem.
 *
 * Lays out the fields operator signed off on (status color bar, category
 * chip, warning/critical badges, title, dates, owner, resources). Width is
 * fixed at 220px so cards line up left-to-right under an L1 row and wrap
 * at the viewport edge.
 *
 * Status drives the color bar and visual states:
 * - completed → entire card opacity-50, title line-through
 * - canceled  → title line-through (no opacity dim)
 *
 * Date formatting uses UTC to match the rest of the Gantt pipeline (see
 * `src/lib/runway/gantt/transform-rows.ts`). Single-day or
 * `endDate === startDate` collapses to "M/D"; otherwise renders
 * "M/D – M/D". Both null → date line hidden.
 */

type Theme = "light" | "dark";

type WeekItemForCard = {
  id: string;
  title: string;
  owner: string | null;
  resources: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  category: string | null;
};

const STATUS_BAR_LIGHT: Record<string, string> = {
  "in-progress": "bg-blue-500",
  scheduled: "bg-slate-300",
  "at-risk": "bg-amber-400",
  blocked: "bg-red-500",
  completed: "bg-emerald-500",
  canceled: "bg-gray-400",
};

const STATUS_BAR_DARK: Record<string, string> = {
  "in-progress": "bg-blue-500/70",
  scheduled: "bg-slate-500/60",
  "at-risk": "bg-amber-400/70",
  blocked: "bg-red-500/70",
  completed: "bg-emerald-500/70",
  canceled: "bg-gray-500/60",
};

function statusBarClass(status: string | null, theme: Theme): string {
  const map = theme === "dark" ? STATUS_BAR_DARK : STATUS_BAR_LIGHT;
  // null/scheduled both fall through to the slate "scheduled" bar
  const key = status ?? "scheduled";
  return map[key] ?? map.scheduled;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function formatDateLine(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate && !endDate) return null;
  if (startDate && (!endDate || startDate === endDate)) {
    return fmt(startDate);
  }
  if (!startDate && endDate) {
    return fmt(endDate);
  }
  // both present and distinct
  return `${fmt(startDate as string)} – ${fmt(endDate as string)}`;
}

export function L2MiniCard({
  weekItem,
  theme = "light",
  warningCount = 0,
  criticalCount = 0,
}: {
  weekItem: WeekItemForCard;
  theme?: Theme;
  warningCount?: number;
  criticalCount?: number;
}) {
  const { title, owner, resources, startDate, endDate, status, category } =
    weekItem;

  const isCompleted = status === "completed";
  const isCanceled = status === "canceled";
  const struck = isCompleted || isCanceled;

  const dateLine = formatDateLine(startDate, endDate);

  const outerBase =
    "relative w-[220px] min-h-[150px] overflow-hidden rounded-md p-2 pt-3";
  const outerTheme =
    theme === "dark"
      ? "bg-slate-900/60 border border-slate-800 hover:bg-slate-800/80"
      : "bg-white border border-slate-200 hover:shadow-md";
  const outerCompletedDim = isCompleted ? "opacity-50" : "";
  const outerClass = [outerBase, outerTheme, outerCompletedDim]
    .filter(Boolean)
    .join(" ");

  const titleClass = [
    "text-[13px] font-semibold leading-snug line-clamp-2",
    theme === "dark" ? "text-slate-100" : "text-slate-900",
    struck ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const metaClass =
    theme === "dark" ? "text-xs text-slate-400" : "text-xs text-slate-500";

  const chipClass = [
    "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
    theme === "dark"
      ? "bg-slate-800 text-slate-300"
      : "bg-slate-100 text-slate-600",
  ].join(" ");

  return (
    <div className={outerClass} data-testid="l2-mini-card">
      <div
        data-testid="status-bar"
        className={`absolute left-0 right-0 top-0 h-[3px] ${statusBarClass(
          status,
          theme,
        )}`}
      />
      {(category || warningCount > 0 || criticalCount > 0) && (
        <div className="mb-1 flex items-center justify-between gap-1">
          {category ? (
            <span data-testid="category-chip" className={chipClass}>
              {category}
            </span>
          ) : (
            <span />
          )}
          {(warningCount > 0 || criticalCount > 0) && (
            <span
              data-testid="alert-badge"
              className="flex items-center gap-1 text-[10px] font-medium"
            >
              {warningCount > 0 ? (
                <span className="text-amber-500">🟡 {warningCount} warn</span>
              ) : null}
              {criticalCount > 0 ? (
                <span className="text-red-500">🔴 {criticalCount} critical</span>
              ) : null}
            </span>
          )}
        </div>
      )}
      <p className={titleClass}>{title}</p>
      {dateLine ? (
        <p data-testid="date-line" className={`mt-1 ${metaClass}`}>
          {dateLine}
        </p>
      ) : null}
      {owner ? (
        <p data-testid="owner-line" className={`mt-0.5 ${metaClass}`}>
          O: {owner}
        </p>
      ) : null}
      {resources ? (
        <p
          data-testid="resources-line"
          className={`mt-0.5 break-words ${metaClass}`}
        >
          {resources}
        </p>
      ) : null}
    </div>
  );
}
