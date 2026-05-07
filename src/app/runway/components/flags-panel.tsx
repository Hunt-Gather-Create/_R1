"use client";

import type { RunwayFlag, FlagSeverity, FlagType } from "@/lib/runway/flags";

// ── Severity styles (for individual flag cards) ────────────────────────────

const SEVERITY_STYLES: Record<FlagSeverity, { icon: string; border: string }> = {
  critical: {
    icon: "text-red-400",
    border: "border-red-500/30",
  },
  warning: {
    icon: "text-amber-400",
    border: "border-amber-500/30",
  },
  info: {
    icon: "text-sky-400",
    border: "border-sky-500/30",
  },
};

// ── Section routing (dashboard-cleanup item 2) ─────────────────────────────

/**
 * Map each FlagType to one of the 3 panel sections.
 * - Delivery Flags: due-date / timing signals
 * - Client Warnings: client-facing / billing / close-out signals
 * - Resourcing Warnings: capacity / staffing signals
 *
 * Enumeration documented here so future flag types have a clear home.
 */
const FLAG_SECTION: Record<FlagType, "delivery" | "client" | "resourcing"> = {
  // Delivery: timing-driven flags that signal a task is due or overdue
  deadline: "delivery",
  "past-end-l2": "delivery",
  // Client: signals visible to the client or tied to account relationship
  stale: "client",
  "retainer-renewal": "client",
  "contract-expired": "client",
  "wrapper-close-out": "client",
  "hierarchy-demotion": "client",
  // Resourcing: staffing capacity and blocking
  "resource-conflict": "resourcing",
  bottleneck: "resourcing",
};

type FlagSection = "delivery" | "client" | "resourcing";

const SECTION_LABELS: Record<FlagSection, string> = {
  delivery: "Delivery Flags",
  client: "Client Warnings",
  resourcing: "Resourcing Warnings",
};

const SECTION_ORDER: FlagSection[] = ["delivery", "client", "resourcing"];

/**
 * Emoji for delivery flags by flag type + whether the deadline is today.
 * dashboard-cleanup item 2 decision: fire emoji for today, clock for upcoming.
 *
 * Today vs tomorrow is keyed off severity (set in detectDeadlines:
 * `severity: isToday ? "warning" : "info"`). Title-matching previously
 * lived here but never fired because flag titles do not contain "today" --
 * the word lives in `flag.detail` instead.
 */
function deliveryEmoji(flag: RunwayFlag): string {
  if (flag.type === "deadline" && flag.severity === "warning") return "🔥"; // today
  if (flag.type === "deadline") return "⏰"; // tomorrow / upcoming
  if (flag.type === "past-end-l2") return "🟠"; // overdue (less alarming than red)
  return "⚠"; // fallback warning
}

// ── Components ─────────────────────────────────────────────────────────────

function FlagCard({ flag }: { flag: RunwayFlag }) {
  const style = SEVERITY_STYLES[flag.severity];
  const iconChar = flag.severity === "critical" ? "⚠"
    : flag.severity === "warning" ? "▲"
    : "●";
  return (
    <div className={`rounded-lg border ${style.border} bg-background/50 p-3`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 text-sm ${style.icon}`} aria-hidden>
          {flag.type === "deadline" || flag.type === "past-end-l2"
            ? deliveryEmoji(flag)
            : iconChar}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{flag.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{flag.detail}</p>
        </div>
      </div>
    </div>
  );
}

interface FlagSectionBlockProps {
  section: FlagSection;
  flags: RunwayFlag[];
}

function FlagSectionBlock({ section, flags }: FlagSectionBlockProps) {
  if (flags.length === 0) return null;
  return (
    <div data-testid={`flag-section-${section}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {SECTION_LABELS[section]} ({flags.length})
      </p>
      <div className="space-y-2">
        {flags.map((flag) => (
          <FlagCard key={flag.id} flag={flag} />
        ))}
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

interface FlagsPanelProps {
  flags: RunwayFlag[];
}

export function FlagsPanel({ flags }: FlagsPanelProps) {
  if (flags.length === 0) return null;

  // Route flags into their sections. Preserve arrival order within each section
  // (the caller already sorts by severity, so severity grouping is preserved).
  const sections: Record<FlagSection, RunwayFlag[]> = {
    delivery: [],
    client: [],
    resourcing: [],
  };
  for (const flag of flags) {
    const section = FLAG_SECTION[flag.type];
    sections[section].push(flag);
  }

  return (
    <aside className="hidden w-80 shrink-0 xl:block">
      <div className="sticky top-[73px] max-h-[calc(100vh-73px)] overflow-y-auto rounded-xl border border-border bg-card/50 p-4">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="font-display text-lg font-bold text-foreground">
            Flags
          </h2>
          <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground">
            {flags.length}
          </span>
        </div>
        <div className="space-y-4">
          {SECTION_ORDER.map((section) => (
            <FlagSectionBlock
              key={section}
              section={section}
              flags={sections[section]}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
