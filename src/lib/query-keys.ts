export const queryKeys = {
  workspace: {
    all: ["workspaces"] as const,
    detail: (id: string) => [...queryKeys.workspace.all, id] as const,
    members: (id: string) =>
      [...queryKeys.workspace.all, id, "members"] as const,
  },
  board: {
    all: ["board"] as const,
    detail: (workspaceId: string) =>
      [...queryKeys.board.all, workspaceId] as const,
  },
  issue: {
    all: ["issues"] as const,
    comments: (issueId: string) =>
      [...queryKeys.issue.all, issueId, "comments"] as const,
    activities: (issueId: string) =>
      [...queryKeys.issue.all, issueId, "activities"] as const,
    chat: (issueId: string) =>
      [...queryKeys.issue.all, issueId, "chat"] as const,
    subtasks: (issueId: string) =>
      [...queryKeys.issue.all, issueId, "subtasks"] as const,
    subtaskCount: (issueId: string) =>
      [...queryKeys.issue.all, issueId, "subtaskCount"] as const,
    attachments: (issueId: string) =>
      [...queryKeys.issue.all, issueId, "attachments"] as const,
  },
  settings: {
    labels: (workspaceId: string) =>
      ["settings", "labels", workspaceId] as const,
    columns: (workspaceId: string) =>
      ["settings", "columns", workspaceId] as const,
    skills: (workspaceId: string) =>
      ["settings", "skills", workspaceId] as const,
    mcpServers: (workspaceId: string) =>
      ["settings", "mcpServers", workspaceId] as const,
  },
} as const;
