import type { SeverityCounts } from "@/lib/runway/gantt/types";

/**
 * Inline severity badge for the By Account view. Renders amber for warn-only,
 * red for critical (with or without warn). Returns null when there are no
 * actionable issues (zero critical + zero warn) or only info-level items.
 */
export function AuditBadge({ severity }: { severity: SeverityCounts }) {
  if (severity.critical === 0 && severity.warn === 0) return null;
  const isCritical = severity.critical > 0;
  const tone = isCritical
    ? "bg-red-500/20 text-red-300 border-red-500/30"
    : "bg-amber-500/20 text-amber-300 border-amber-500/30";
  const warnLabel = (n: number) => (n === 1 ? "1 warning" : `${n} warnings`);
  const label = isCritical
    ? `${severity.critical} critical${severity.warn > 0 ? `, ${warnLabel(severity.warn)}` : ""}`
    : warnLabel(severity.warn);

  return (
    <span
      data-testid="audit-badge"
      data-severity={isCritical ? "critical" : "warn"}
      title="View details locally"
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
