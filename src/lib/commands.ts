import type { IssueWithLabels } from "./types";

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  icon?: string;
  group: "navigation" | "actions" | "issues" | "settings";
  keywords?: string[];
  action: () => void;
}

export type CommandGroup = {
  heading: string;
  commands: Command[];
};

// Create command groups from commands
export function groupCommands(commands: Command[]): CommandGroup[] {
  const groups: Record<string, Command[]> = {};

  commands.forEach((cmd) => {
    if (!groups[cmd.group]) {
      groups[cmd.group] = [];
    }
    groups[cmd.group].push(cmd);
  });

  const headings: Record<string, string> = {
    navigation: "Navigation",
    actions: "Actions",
    issues: "Issues",
    settings: "Settings",
  };

  return Object.entries(groups).map(([group, cmds]) => ({
    heading: headings[group] || group,
    commands: cmds,
  }));
}

// Filter commands by search query
export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query) return commands;

  const lowerQuery = query.toLowerCase();

  return commands.filter((cmd) => {
    const matchLabel = cmd.label.toLowerCase().includes(lowerQuery);
    const matchKeywords = cmd.keywords?.some((k) =>
      k.toLowerCase().includes(lowerQuery)
    );
    return matchLabel || matchKeywords;
  });
}

// Search issues by query
export function searchIssues(
  issues: IssueWithLabels[],
  query: string
): IssueWithLabels[] {
  if (!query) return issues.slice(0, 10);

  const lowerQuery = query.toLowerCase();

  return issues
    .filter((issue) => {
      const matchTitle = issue.title.toLowerCase().includes(lowerQuery);
      const matchIdentifier = issue.identifier.toLowerCase().includes(lowerQuery);
      const matchDescription = issue.description
        ?.toLowerCase()
        .includes(lowerQuery);
      const matchLabels = issue.labels.some((l) =>
        l.name.toLowerCase().includes(lowerQuery)
      );
      return matchTitle || matchIdentifier || matchDescription || matchLabels;
    })
    .slice(0, 10);
}

// Default navigation commands
export function createNavigationCommands(handlers: {
  goToBoard: () => void;
  goToList: () => void;
  toggleSidebar: () => void;
}): Command[] {
  return [
    {
      id: "go-to-board",
      label: "Go to Board",
      shortcut: "G B",
      group: "navigation",
      keywords: ["kanban", "board", "columns"],
      action: handlers.goToBoard,
    },
    {
      id: "go-to-list",
      label: "Go to List",
      shortcut: "G L",
      group: "navigation",
      keywords: ["list", "table", "issues"],
      action: handlers.goToList,
    },
    {
      id: "toggle-sidebar",
      label: "Toggle Sidebar",
      shortcut: "[",
      group: "navigation",
      keywords: ["sidebar", "menu", "navigation"],
      action: handlers.toggleSidebar,
    },
  ];
}

// Default action commands
export function createActionCommands(handlers: {
  createIssue: () => void;
  openSearch: () => void;
}): Command[] {
  return [
    {
      id: "create-issue",
      label: "Create Issue",
      shortcut: "C",
      group: "actions",
      keywords: ["new", "add", "create", "issue", "task"],
      action: handlers.createIssue,
    },
    {
      id: "open-search",
      label: "Search Issues",
      shortcut: "/",
      group: "actions",
      keywords: ["search", "find", "filter"],
      action: handlers.openSearch,
    },
  ];
}

// Create issue commands from issues list
export function createIssueCommands(
  issues: IssueWithLabels[],
  onSelectIssue: (issue: IssueWithLabels) => void
): Command[] {
  return issues.slice(0, 10).map((issue) => ({
    id: `issue-${issue.id}`,
    label: issue.title,
    group: "issues" as const,
    keywords: [issue.identifier, ...issue.labels.map((l) => l.name)],
    action: () => onSelectIssue(issue),
  }));
}
