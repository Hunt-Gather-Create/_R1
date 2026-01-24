import type { IssueWithLabels } from "./types";
import type { Status, Priority } from "./design-tokens";

export interface FilterState {
  status: Status[];
  priority: Priority[];
  labels: string[];
  cycleId: string | null;
  hasDueDate: boolean | null;
  isOverdue: boolean | null;
  search: string;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  status: [],
  priority: [],
  labels: [],
  cycleId: null,
  hasDueDate: null,
  isOverdue: null,
  search: "",
};

export function filterIssues(
  issues: IssueWithLabels[],
  filters: FilterState
): IssueWithLabels[] {
  return issues.filter((issue) => {
    // Status filter
    if (filters.status.length > 0) {
      if (!filters.status.includes(issue.status as Status)) {
        return false;
      }
    }

    // Priority filter
    if (filters.priority.length > 0) {
      if (!filters.priority.includes(issue.priority as Priority)) {
        return false;
      }
    }

    // Labels filter
    if (filters.labels.length > 0) {
      const issueLabels = issue.labels.map((l) => l.id);
      if (!filters.labels.some((labelId) => issueLabels.includes(labelId))) {
        return false;
      }
    }

    // Cycle filter
    if (filters.cycleId !== null) {
      if (issue.cycleId !== filters.cycleId) {
        return false;
      }
    }

    // Has due date filter
    if (filters.hasDueDate !== null) {
      if (filters.hasDueDate && !issue.dueDate) {
        return false;
      }
      if (!filters.hasDueDate && issue.dueDate) {
        return false;
      }
    }

    // Is overdue filter
    if (filters.isOverdue !== null && filters.isOverdue) {
      if (!issue.dueDate) {
        return false;
      }
      const now = new Date();
      const dueDate = new Date(issue.dueDate);
      if (dueDate >= now) {
        return false;
      }
    }

    // Search filter
    if (filters.search) {
      const query = filters.search.toLowerCase();
      const matchTitle = issue.title.toLowerCase().includes(query);
      const matchIdentifier = issue.identifier.toLowerCase().includes(query);
      const matchDescription = issue.description?.toLowerCase().includes(query);
      const matchLabels = issue.labels.some((l) =>
        l.name.toLowerCase().includes(query)
      );
      if (
        !matchTitle &&
        !matchIdentifier &&
        !matchDescription &&
        !matchLabels
      ) {
        return false;
      }
    }

    return true;
  });
}

// Serialize filters to URL params
export function serializeFilters(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.status.length > 0) {
    params.set("status", filters.status.join(","));
  }
  if (filters.priority.length > 0) {
    params.set("priority", filters.priority.join(","));
  }
  if (filters.labels.length > 0) {
    params.set("labels", filters.labels.join(","));
  }
  if (filters.cycleId) {
    params.set("cycle", filters.cycleId);
  }
  if (filters.hasDueDate !== null) {
    params.set("hasDueDate", String(filters.hasDueDate));
  }
  if (filters.isOverdue !== null) {
    params.set("isOverdue", String(filters.isOverdue));
  }
  if (filters.search) {
    params.set("q", filters.search);
  }

  return params;
}

// Deserialize filters from URL params
export function deserializeFilters(params: URLSearchParams): FilterState {
  return {
    status:
      (params.get("status")?.split(",").filter(Boolean) as Status[]) || [],
    priority:
      (params
        .get("priority")
        ?.split(",")
        .filter(Boolean)
        .map(Number) as Priority[]) || [],
    labels: params.get("labels")?.split(",").filter(Boolean) || [],
    cycleId: params.get("cycle") || null,
    hasDueDate: params.has("hasDueDate")
      ? params.get("hasDueDate") === "true"
      : null,
    isOverdue: params.has("isOverdue")
      ? params.get("isOverdue") === "true"
      : null,
    search: params.get("q") || "",
  };
}

// Count active filters
export function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.status.length > 0) count++;
  if (filters.priority.length > 0) count++;
  if (filters.labels.length > 0) count++;
  if (filters.cycleId) count++;
  if (filters.hasDueDate !== null) count++;
  if (filters.isOverdue !== null) count++;
  return count;
}
