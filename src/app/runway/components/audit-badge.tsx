"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import type { SeverityCounts } from "@/lib/runway/gantt/types";

/**
 * Per-issue shape consumed by the expanding audit panel. Each entry is
 * either a chart-level issue (single `message`) or a row-level group
 * (one or more `refs`, one entry per shared code). `sectionTitle` lets the
 * panel cluster issues by their originating rundown section.
 */
export type AuditIssue = {
  severity: "critical" | "warn" | "info";
  code: string;
  message?: string;
  refs?: { id: string; title: string }[];
  sectionTitle?: string;
};

const SEVERITY_RANK: Record<AuditIssue["severity"], number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

const SEVERITY_LABEL: Record<AuditIssue["severity"], string> = {
  critical: "Critical",
  warn: "Warning",
  info: "Info",
};

const CLIPBOARD_SEVERITY_PREFIX: Record<AuditIssue["severity"], string> = {
  critical: "[CRITICAL]",
  warn: "[WARNING]",
  info: "[INFO]",
};

/**
 * #76 — serialize an issue list to a paste-friendly multi-line string.
 * One line per issue, format:
 *
 *   [CRITICAL] <Section Title> — <rule code>: <message>
 *
 * Row-level issues (no `message`, one or more `refs`) use the joined ref
 * titles as the trailing detail. Issues without a `sectionTitle` collapse
 * to `[SEVERITY] <code>: <detail>` (no section prefix). Empty list → "".
 */
export function formatIssuesForClipboard(issues: AuditIssue[]): string {
  return issues.map(formatIssueLine).join("\n");
}

function formatIssueLine(issue: AuditIssue): string {
  const prefix = CLIPBOARD_SEVERITY_PREFIX[issue.severity];
  const detail =
    issue.message ??
    (issue.refs?.length ? issue.refs.map((r) => r.title).join(", ") : "");
  const head = issue.sectionTitle
    ? `${prefix} ${issue.sectionTitle} — ${issue.code}`
    : `${prefix} ${issue.code}`;
  return detail ? `${head}: ${detail}` : head;
}

/**
 * Inline severity badge for the Gantt Charts account card. Renders amber
 * for warn-only, red for critical (with or without warn). Returns null
 * when there are no actionable issues (zero critical + zero warn) or only
 * info-level items.
 *
 * When `issues` is provided the badge becomes a toggle button; click /
 * Enter / Space opens an inline panel below the pill listing every
 * contributing issue (chart + row-level), grouped by section. Esc and
 * outside-click collapse the panel. (#66)
 */
export function AuditBadge({
  severity,
  issues,
}: {
  severity: SeverityCounts;
  issues?: AuditIssue[];
}) {
  if (severity.critical === 0 && severity.warn === 0) return null;
  const isCritical = severity.critical > 0;
  const tone = isCritical
    ? "bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30"
    : "bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30";
  const warnLabel = (n: number) => (n === 1 ? "1 warning" : `${n} warnings`);
  const label = isCritical
    ? `${severity.critical} critical${severity.warn > 0 ? `, ${warnLabel(severity.warn)}` : ""}`
    : warnLabel(severity.warn);

  // Back-compat: zero issues passed in → render the static span (matches
  // the pre-#66 visual + existing test snapshots that don't thread issues).
  const interactive = (issues?.length ?? 0) > 0;
  if (!interactive) {
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

  return (
    <AuditBadgeInteractive
      severity={isCritical ? "critical" : "warn"}
      tone={tone}
      label={label}
      issues={issues!}
    />
  );
}

function AuditBadgeInteractive({
  severity,
  tone,
  label,
  issues,
}: {
  severity: "critical" | "warn";
  tone: string;
  label: string;
  issues: AuditIssue[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointer(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  function handleClick(event: React.MouseEvent) {
    // Don't let the surrounding <summary>'s native click toggle the
    // <details> open/closed when the user is just inspecting issues.
    event.preventDefault();
    event.stopPropagation();
    setOpen((prev) => !prev);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      setOpen((prev) => !prev);
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        onKeyDown={handleKey}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="audit-badge"
        data-severity={severity}
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${tone}`}
      >
        {label}
        <span aria-hidden="true" className="ml-1 opacity-70">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Contributing issues"
          data-testid="audit-badge-panel"
          className="absolute right-0 top-full z-20 mt-1 max-h-96 w-96 max-w-[90vw] overflow-y-auto rounded-md border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200 shadow-lg"
        >
          <CopyToClipboardButton issues={issues} />
          <AuditIssueList issues={issues} />
        </div>
      )}
    </div>
  );
}

/**
 * #76 — clipboard glyph in the top-right of the open panel. Click writes
 * the formatted issue list (one issue per line) via the Clipboard API,
 * flashes a checkmark for ~1s on success, surfaces a sonner error toast
 * if the write rejects (rare — usually a permissions case in non-secure
 * contexts).
 */
function CopyToClipboardButton({ issues }: { issues: AuditIssue[] }) {
  const [state, setState] = useState<"idle" | "copied">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const payload = formatIssuesForClipboard(issues);
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      toast.error("Copy failed — try again.");
      return;
    }
    setState("copied");
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 1000);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="audit-badge-copy"
      data-state={state}
      aria-label="Copy issues to clipboard"
      className="float-right mb-1 ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
    >
      {state === "copied" ? <CheckGlyph /> : <ClipboardGlyph />}
    </button>
  );
}

function ClipboardGlyph() {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <rect x="3" y="2" width="7" height="9" rx="1" />
      <rect x="5" y="4" width="7" height="9" rx="1" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M3 7.5 L6 10.5 L11 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AuditIssueList({ issues }: { issues: AuditIssue[] }) {
  const sortedSections = groupAndSort(issues);
  if (sortedSections.length === 0) {
    return (
      <p className="px-1 py-0.5 text-slate-400">No contributing issues.</p>
    );
  }
  return (
    <div className="space-y-2">
      {sortedSections.map((group) => (
        <section key={group.sectionTitle}>
          {group.sectionTitle ? (
            <h4 className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {group.sectionTitle}
            </h4>
          ) : null}
          <ul className="space-y-1">
            {group.items.map((issue, i) => (
              <AuditIssueRow key={`${issue.code}-${i}`} issue={issue} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AuditIssueRow({ issue }: { issue: AuditIssue }) {
  const dot =
    issue.severity === "critical"
      ? "bg-red-400"
      : issue.severity === "warn"
        ? "bg-amber-400"
        : "bg-sky-400";
  const refsLine = issue.refs && issue.refs.length > 0
    ? issue.refs.map((r) => r.title).join(", ")
    : null;
  return (
    <li className="rounded px-1 py-0.5 hover:bg-slate-800/50">
      <div className="flex items-baseline gap-1.5">
        <span
          aria-label={SEVERITY_LABEL[issue.severity]}
          className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
        />
        <code className="text-[11px] font-mono text-slate-300">{issue.code}</code>
        {issue.refs && issue.refs.length > 0 ? (
          <span className="text-[10px] text-slate-500">({issue.refs.length})</span>
        ) : null}
      </div>
      {refsLine ? (
        <div className="pl-3 text-slate-400">{refsLine}</div>
      ) : null}
      {issue.message ? (
        <div className="pl-3 text-slate-400">{issue.message}</div>
      ) : null}
    </li>
  );
}

type AuditSectionGroup = {
  sectionTitle: string;
  items: AuditIssue[];
};

function groupAndSort(issues: AuditIssue[]): AuditSectionGroup[] {
  const bySection = new Map<string, AuditIssue[]>();
  for (const issue of issues) {
    const key = issue.sectionTitle ?? "";
    const bucket = bySection.get(key);
    if (bucket) bucket.push(issue);
    else bySection.set(key, [issue]);
  }
  const groups: AuditSectionGroup[] = [];
  for (const [sectionTitle, items] of bySection.entries()) {
    const sorted = [...items].sort((a, b) => {
      const sd = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sd !== 0) return sd;
      return a.code.localeCompare(b.code);
    });
    groups.push({ sectionTitle, items: sorted });
  }
  // Preserve insertion order across sections — matches the rundown order
  // upstream callers build.
  return groups;
}
