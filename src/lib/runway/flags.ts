/**
 * Runway Flag Analysis — detects actionable conditions from board data
 *
 * Scans accounts, week items, and pipeline data for:
 * - Resource conflicts (person overloaded across clients)
 * - Stale items (no updates for 14+ days)
 * - Upcoming deadlines (due today/tomorrow)
 * - Bottlenecks (person blocking 3+ items)
 */

import type { Account, DayItem, PipelineItem } from "@/app/runway/types";
import {
  detectResourceConflicts,
  detectStaleItems,
  detectDeadlines,
  detectBottlenecks,
} from "./flags-detectors";

export type FlagSeverity = "critical" | "warning" | "info";
export type FlagType = "resource-conflict" | "stale" | "deadline" | "bottleneck";

export interface RunwayFlag {
  id: string;
  type: FlagType;
  severity: FlagSeverity;
  title: string;
  detail: string;
  relatedClient?: string;
  relatedPerson?: string;
}

/**
 * Analyze board data and return all detected flags,
 * sorted by severity (critical first, then warning, then info).
 */
export function analyzeFlags(
  accounts: Account[],
  thisWeek: DayItem[],
  upcoming: DayItem[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pipeline: PipelineItem[]
): RunwayFlag[] {
  const flags = [
    ...detectResourceConflicts(thisWeek, upcoming),
    ...detectStaleItems(accounts),
    ...detectDeadlines(thisWeek),
    ...detectBottlenecks(accounts),
  ];

  const severityOrder: Record<FlagSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  flags.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return flags;
}
