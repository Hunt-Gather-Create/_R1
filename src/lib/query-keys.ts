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
    aiSuggestions: (issueId: string) =>
      [...queryKeys.issue.all, issueId, "aiSuggestions"] as const,
    aiTaskStatus: (issueId: string) =>
      [...queryKeys.issue.all, issueId, "aiTaskStatus"] as const,
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
    brand: (workspaceId: string) =>
      ["settings", "brand", workspaceId] as const,
    jobs: (workspaceId: string) =>
      ["settings", "jobs", workspaceId] as const,
    memories: (workspaceId: string) =>
      ["settings", "memories", workspaceId] as const,
  },
  smithery: {
    servers: (query: string, page: number, verifiedOnly: boolean) =>
      ["smithery", "servers", query, page, verifiedOnly] as const,
  },
  workspaceChat: {
    all: (workspaceId: string) => ["workspaceChats", workspaceId] as const,
    detail: (chatId: string) => ["workspaceChats", "detail", chatId] as const,
    messages: (chatId: string) =>
      ["workspaceChats", "messages", chatId] as const,
    attachments: (chatId: string) =>
      ["workspaceChats", "attachments", chatId] as const,
  },
  soul: {
    chat: (workspaceId: string) => ["soul", workspaceId, "chat"] as const,
  },
  knowledge: {
    folders: (workspaceId: string) => ["knowledge", workspaceId, "folders"] as const,
    documents: (workspaceId: string, folderId?: string | null, tag?: string | null, query?: string | null) =>
      ["knowledge", workspaceId, "documents", folderId ?? null, tag ?? null, query ?? null] as const,
    document: (documentId: string) => ["knowledge", "document", documentId] as const,
    issueLinks: (issueId: string) => ["knowledge", "issueLinks", issueId] as const,
    tags: (workspaceId: string) => ["knowledge", workspaceId, "tags"] as const,
  },
} as const;
