"use client";

import { useState, useCallback } from "react";
import { Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITY_CONFIG } from "@/lib/design-tokens";
import { LexicalMarkdownPreview } from "@/components/ui/lexical";
import { PriorityIcon } from "@/components/issues/PriorityIcon";
import type { PlannedIssue, EpicSummary } from "./PlanningChatPanel";

interface PlannedIssuesPanelProps {
  issues: PlannedIssue[];
  onUpdateIssue: (id: string, updates: Partial<PlannedIssue>) => void;
  onRemoveIssue: (id: string) => void;
  onCreateAll: () => void;
  isCreating: boolean;
  epicSummary?: EpicSummary | null;
}

function IssueCard({
  issue,
  onUpdate,
  onRemove,
}: {
  issue: PlannedIssue;
  onUpdate: (updates: Partial<PlannedIssue>) => void;
  onRemove: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(issue.title);
  const [editDescription, setEditDescription] = useState(issue.description);

  const handleSave = useCallback(() => {
    onUpdate({
      title: editTitle.trim(),
      description: editDescription.trim(),
    });
    setIsEditing(false);
  }, [editTitle, editDescription, onUpdate]);

  const handleCancel = useCallback(() => {
    setEditTitle(issue.title);
    setEditDescription(issue.description);
    setIsEditing(false);
  }, [issue.title, issue.description]);

  const statusIcon =
    issue.status === "creating" ? (
      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
    ) : issue.status === "created" ? (
      <Check className="w-4 h-4 text-green-500" />
    ) : null;

  if (isEditing) {
    return (
      <div className="p-3 rounded-lg border border-border bg-card">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="w-full px-2 py-1 text-sm font-medium bg-background border border-border rounded mb-2 focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Issue title"
          autoFocus
        />
        <textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          className="w-full px-2 py-1 text-sm bg-background border border-border rounded resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Description with acceptance criteria..."
          rows={4}
        />
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={handleCancel}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={handleSave}
            className="p-1 rounded hover:bg-muted text-primary"
          >
            <Check className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group p-3 rounded-lg border border-border bg-card hover:border-border/80 transition-colors",
        issue.status === "created" && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium truncate">{issue.title}</h4>
            {statusIcon}
          </div>
          <LexicalMarkdownPreview
            content={issue.description}
            className="text-xs text-muted-foreground mt-1 prose-p:my-0.5 prose-ul:my-0.5 prose-li:my-0 prose-headings:my-1 prose-headings:text-xs"
          />
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {issue.status === "pending" && (
            <>
              <button
                onClick={() => setIsEditing(true)}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                title="Edit"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onRemove}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-500"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <PriorityIcon priority={issue.priority} size="sm" />
        <span className="text-xs text-muted-foreground">
          {PRIORITY_CONFIG[issue.priority].label}
        </span>
      </div>
    </div>
  );
}

export function PlannedIssuesPanel({
  issues,
  onUpdateIssue,
  onRemoveIssue,
  onCreateAll,
  isCreating,
  epicSummary,
}: PlannedIssuesPanelProps) {
  const pendingCount = issues.filter((i) => i.status === "pending").length;
  const createdCount = issues.filter((i) => i.status === "created").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <div>
          <h3 className="text-sm font-medium">
            {epicSummary ? epicSummary.title : "Planned Issues"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {issues.length === 0
              ? "Issues will appear here as you chat"
              : `${pendingCount} pending, ${createdCount} created`}
          </p>
        </div>
      </div>

      {/* Issue List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <svg
                className="w-6 h-6 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">
              Start chatting with the AI to plan your issues.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Issues will be added here as you discuss requirements.
            </p>
          </div>
        ) : (
          issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onUpdate={(updates) => onUpdateIssue(issue.id, updates)}
              onRemove={() => onRemoveIssue(issue.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {issues.length > 0 && (
        <div className="p-4 border-t border-border shrink-0">
          <button
            onClick={onCreateAll}
            disabled={pendingCount === 0 || isCreating}
            className={cn(
              "w-full py-2 px-4 rounded-md text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isCreating ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating Issues...
              </span>
            ) : (
              `Create ${pendingCount} Issue${pendingCount !== 1 ? "s" : ""}`
            )}
          </button>
        </div>
      )}
    </div>
  );
}
