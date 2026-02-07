"use client";

import { useMemo } from "react";
import { useAppShell } from "@/components/layout/AppShell";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { GROUP_BY, PRIORITY_CONFIG, type Priority } from "@/lib/design-tokens";
import { sortIssues, createVirtualColumn, type IssueGroup } from "../list-utils";
import type { IssueWithLabels } from "@/lib/types";
import type { SortField, SortDirection } from "../ListHeader";

export type { IssueGroup };

export function useGroupedIssues(
  sortField: SortField,
  sortDirection: SortDirection
) {
  const { board } = useBoardContext();
  const { groupBy } = useAppShell();

  const groups: IssueGroup[] = useMemo(() => {
    const allIssues = board.columns.flatMap((col) => col.issues);

    if (groupBy === GROUP_BY.NONE) {
      return [
        {
          id: "all",
          column: createVirtualColumn("all", "All Issues", board.id, allIssues),
          issues: sortIssues(allIssues, sortField, sortDirection),
        },
      ];
    }

    if (groupBy === GROUP_BY.STATUS) {
      return board.columns.map((col) => ({
        id: col.id,
        column: col,
        issues: sortIssues(col.issues, sortField, sortDirection),
      }));
    }

    if (groupBy === GROUP_BY.PRIORITY) {
      const priorityGroups = new Map<number, IssueWithLabels[]>();
      for (const issue of allIssues) {
        const list = priorityGroups.get(issue.priority) ?? [];
        list.push(issue);
        priorityGroups.set(issue.priority, list);
      }

      return Array.from(priorityGroups.entries())
        .sort(([a], [b]) => a - b)
        .map(([priority, issues]) => {
          const config = PRIORITY_CONFIG[priority as Priority];
          return {
            id: `priority-${priority}`,
            column: createVirtualColumn(
              `priority-${priority}`,
              config?.label ?? `Priority ${priority}`,
              board.id,
              issues,
              priority
            ),
            issues: sortIssues(issues, sortField, sortDirection),
          };
        });
    }

    if (groupBy === GROUP_BY.LABEL) {
      const labelGroups = new Map<string, IssueWithLabels[]>();
      const unlabeled: IssueWithLabels[] = [];

      for (const issue of allIssues) {
        if (issue.labels.length === 0) {
          unlabeled.push(issue);
        } else {
          for (const label of issue.labels) {
            const list = labelGroups.get(label.id) ?? [];
            list.push(issue);
            labelGroups.set(label.id, list);
          }
        }
      }

      const result: IssueGroup[] = Array.from(labelGroups.entries()).map(
        ([labelId, issues]) => {
          const label = issues[0]?.labels.find((l) => l.id === labelId);
          return {
            id: `label-${labelId}`,
            column: createVirtualColumn(
              `label-${labelId}`,
              label?.name ?? "Unknown",
              board.id,
              issues
            ),
            issues: sortIssues(issues, sortField, sortDirection),
          };
        }
      );

      if (unlabeled.length > 0) {
        result.push({
          id: "no-label",
          column: createVirtualColumn("no-label", "No Label", board.id, unlabeled, 999),
          issues: sortIssues(unlabeled, sortField, sortDirection),
        });
      }

      return result;
    }

    // Default: group by status columns
    return board.columns.map((col) => ({
      id: col.id,
      column: col,
      issues: sortIssues(col.issues, sortField, sortDirection),
    }));
  }, [board, groupBy, sortField, sortDirection]);

  const flatIssues = useMemo(
    () => groups.flatMap((g) => g.issues),
    [groups]
  );

  const dndEnabled = groupBy === GROUP_BY.STATUS;
  const showGroups = groupBy !== GROUP_BY.NONE;

  return { groups, flatIssues, dndEnabled, showGroups, groupBy };
}
