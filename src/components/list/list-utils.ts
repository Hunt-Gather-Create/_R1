import type { IssueWithLabels, ColumnWithIssues } from "@/lib/types";
import type { SortField, SortDirection } from "./ListHeader";

export interface IssueGroup {
  id: string;
  column: ColumnWithIssues;
  issues: IssueWithLabels[];
}

export function sortIssues(
  issues: IssueWithLabels[],
  sortField: SortField,
  sortDirection: SortDirection
): IssueWithLabels[] {
  return [...issues].sort((a, b) => {
    let comparison = 0;

    switch (sortField) {
      case "identifier":
        comparison = a.identifier.localeCompare(b.identifier);
        break;
      case "status":
        comparison = a.status.localeCompare(b.status);
        break;
      case "priority":
        comparison = a.priority - b.priority;
        break;
      case "title":
        comparison = a.title.localeCompare(b.title);
        break;
      case "dueDate": {
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        comparison = aDate - bDate;
        break;
      }
      case "estimate":
        comparison = (a.estimate ?? 0) - (b.estimate ?? 0);
        break;
      case "createdAt":
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "updatedAt":
        comparison =
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });
}

export function createVirtualColumn(
  id: string,
  name: string,
  workspaceId: string,
  issues: IssueWithLabels[],
  position: number = 0
): ColumnWithIssues {
  return { id, name, workspaceId, status: null, position, isSystem: false, issues };
}
