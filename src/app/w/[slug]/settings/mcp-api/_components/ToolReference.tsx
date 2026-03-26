"use client";

const TOOLS = [
  {
    name: "get-board-overview",
    description: "Board overview: columns with issues, labels, and cycles",
    role: "viewer+",
    params: "None (uses connected workspace)",
  },
  {
    name: "list-issues",
    description: "List and filter issues by status, priority, label, cycle, assignee, or search query",
    role: "viewer+",
    params: "status?, priority?, labelId?, cycleId?, assigneeId?, query?",
  },
  {
    name: "create-issue",
    description: "Create a new issue with title, description, status, priority, labels, and more",
    role: "member+",
    params: "title, description?, status?, priority?, labelIds[]?, cycleId?, epicId?, assigneeId?, estimate?, dueDate?",
  },
  {
    name: "update-issue",
    description: "Update any issue fields. Auto-moves to matching column on status change.",
    role: "member+",
    params: "issueId, title?, description?, status?, priority?, cycleId?, assigneeId?, estimate?, dueDate?",
  },
  {
    name: "create-subtask",
    description: "Create a subtask under a parent issue",
    role: "member+",
    params: "parentIssueId, title, description?, status?, priority?, assigneeId?",
  },
  {
    name: "add-comment",
    description: "Add a comment to an issue",
    role: "member+",
    params: "issueId, body",
  },
  {
    name: "search-knowledge",
    description: "Search knowledge base documents by query, tag, or folder",
    role: "viewer+",
    params: "query?, tag?, folderId?, limit?",
  },
  {
    name: "list-cycles",
    description: "List cycles/sprints with status and issue counts",
    role: "viewer+",
    params: "includeIssues?",
  },
];

const RESOURCES = [
  {
    uri: "insight://workspace",
    description: "Current workspace info: name, slug, purpose, columns, labels, member count",
  },
  {
    uri: "insight://issue/{issueId}",
    description: "Full issue detail with labels, comments, activities, and subtasks",
  },
];

export function ToolReference() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-4">
        Available Tools
      </h2>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                Tool
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                Description
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                Role
              </th>
            </tr>
          </thead>
          <tbody>
            {TOOLS.map((tool) => (
              <tr key={tool.name} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                  {tool.name}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {tool.description}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                  {tool.role}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold text-foreground mt-8 mb-4">
        Resources
      </h2>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                URI
              </th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            {RESOURCES.map((resource) => (
              <tr
                key={resource.uri}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                  {resource.uri}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {resource.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
