"use client";

import { Plus, Trash2, FileText } from "lucide-react";
import type { Status } from "@/lib/design-tokens";
import type { WorkspaceColumn, WorkspaceLabel, SuggestedIssue } from "./ConfigurationChat";

interface ConfigurationPreviewProps {
  workspaceName: string;
  columns: WorkspaceColumn[];
  labels: WorkspaceLabel[];
  issues: SuggestedIssue[];
  onColumnsChange: (columns: WorkspaceColumn[]) => void;
  onLabelsChange: (labels: WorkspaceLabel[]) => void;
  onIssuesChange: (issues: SuggestedIssue[]) => void;
  onCreateWorkspace: () => void;
  isCreating: boolean;
}

const STATUS_OPTIONS: Array<{ value: Status | null; label: string }> = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "canceled", label: "Canceled" },
  { value: null, label: "None" },
];

export function ConfigurationPreview({
  workspaceName,
  columns,
  labels,
  issues,
  onColumnsChange,
  onLabelsChange,
  onIssuesChange,
  onCreateWorkspace,
  isCreating,
}: ConfigurationPreviewProps) {
  const canDeleteColumn = columns.length > 2;
  const canAddColumn = columns.length < 8;
  const canAddLabel = labels.length < 8;
  const canAddIssue = issues.length < 10;

  const handleColumnNameChange = (id: string, name: string) => {
    onColumnsChange(
      columns.map((col) => (col.id === id ? { ...col, name } : col))
    );
  };

  const handleColumnStatusChange = (id: string, status: Status | null) => {
    onColumnsChange(
      columns.map((col) => (col.id === id ? { ...col, status } : col))
    );
  };

  const handleDeleteColumn = (id: string) => {
    if (!canDeleteColumn) return;
    onColumnsChange(columns.filter((col) => col.id !== id));
  };

  const handleAddColumn = () => {
    if (!canAddColumn) return;
    onColumnsChange([
      ...columns,
      { id: crypto.randomUUID(), name: "New Column", status: null },
    ]);
  };

  const handleDeleteLabel = (index: number) => {
    onLabelsChange(labels.filter((_, i) => i !== index));
  };

  const handleAddLabel = () => {
    if (!canAddLabel) return;
    const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
    const usedColors = new Set(labels.map((l) => l.color));
    const availableColor = colors.find((c) => !usedColors.has(c)) || colors[0];
    onLabelsChange([...labels, { name: "New Label", color: availableColor }]);
  };

  const handleLabelNameChange = (index: number, name: string) => {
    onLabelsChange(labels.map((l, i) => (i === index ? { ...l, name } : l)));
  };

  const handleDeleteIssue = (id: string) => {
    onIssuesChange(issues.filter((issue) => issue.id !== id));
  };

  const handleAddIssue = () => {
    if (!canAddIssue) return;
    onIssuesChange([
      ...issues,
      { id: crypto.randomUUID(), title: "New Issue", description: "" },
    ]);
  };

  const handleIssueTitleChange = (id: string, title: string) => {
    onIssuesChange(
      issues.map((issue) => (issue.id === id ? { ...issue, title } : issue))
    );
  };

  return (
    <div className="flex flex-col h-full bg-card/30">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">{workspaceName}</h2>
        <p className="text-sm text-muted-foreground">Workspace preview</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Columns */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-foreground">
              Columns ({columns.length})
            </h3>
            <button
              onClick={handleAddColumn}
              disabled={!canAddColumn}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          </div>

          {columns.length === 0 ? (
            <div className="text-sm text-muted-foreground italic py-4 text-center border border-dashed border-border rounded-lg">
              No columns yet. Chat with the AI to configure your workflow.
            </div>
          ) : (
            <div className="space-y-2">
              {columns.map((column, index) => (
                <div
                  key={column.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border/40"
                >
                  <span className="text-xs text-muted-foreground w-4 flex-shrink-0">
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    value={column.name}
                    onChange={(e) =>
                      handleColumnNameChange(column.id, e.target.value)
                    }
                    className="flex-1 px-2 py-1 bg-background border border-input rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <select
                    value={column.status ?? ""}
                    onChange={(e) =>
                      handleColumnStatusChange(
                        column.id,
                        e.target.value === "" ? null : (e.target.value as Status)
                      )
                    }
                    className="px-1.5 py-1 bg-background border border-input rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value ?? "null"} value={opt.value ?? ""}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleDeleteColumn(column.id)}
                    disabled={!canDeleteColumn}
                    className="p-1 rounded text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Labels */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-foreground">
              Labels ({labels.length})
            </h3>
            <button
              onClick={handleAddLabel}
              disabled={!canAddLabel}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          </div>

          {labels.length === 0 ? (
            <div className="text-sm text-muted-foreground italic py-4 text-center border border-dashed border-border rounded-lg">
              No labels yet. The AI can suggest relevant labels.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {labels.map((label, index) => (
                <div
                  key={index}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs group"
                  style={{
                    backgroundColor: `${label.color}20`,
                    color: label.color,
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <input
                    type="text"
                    value={label.name}
                    onChange={(e) => handleLabelNameChange(index, e.target.value)}
                    className="bg-transparent border-none outline-none w-16 text-xs"
                    style={{ color: label.color }}
                  />
                  <button
                    onClick={() => handleDeleteLabel(index)}
                    className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Starter Issues */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-foreground">
              Starter Issues ({issues.length})
            </h3>
            <button
              onClick={handleAddIssue}
              disabled={!canAddIssue}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          </div>

          {issues.length === 0 ? (
            <div className="text-sm text-muted-foreground italic py-4 text-center border border-dashed border-border rounded-lg">
              No starter issues yet. The AI will suggest some to help you get started.
            </div>
          ) : (
            <div className="space-y-2">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 border border-border/40 group"
                >
                  <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <input
                    type="text"
                    value={issue.title}
                    onChange={(e) =>
                      handleIssueTitleChange(issue.id, e.target.value)
                    }
                    className="flex-1 px-2 py-0.5 bg-background border border-input rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={() => handleDeleteIssue(issue.id)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <button
          onClick={onCreateWorkspace}
          disabled={columns.length < 2 || isCreating}
          className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCreating ? "Creating..." : "Create Workspace"}
        </button>
        {columns.length < 2 && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            At least 2 columns required
          </p>
        )}
      </div>
    </div>
  );
}
