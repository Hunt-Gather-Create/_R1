"use client";

import { useState, useEffect } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { X, MoreHorizontal, Trash2, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusSelect } from "./properties/StatusSelect";
import { PrioritySelect } from "./properties/PrioritySelect";
import { LabelSelect } from "./properties/LabelSelect";
import { DatePicker } from "./properties/DatePicker";
import { EstimateInput } from "./properties/EstimateInput";
import { Comments } from "./Comments";
import { ActivityFeed } from "./ActivityFeed";
import {
  getIssueComments,
  getIssueActivities,
  addComment,
  updateComment,
  deleteComment,
} from "@/lib/actions/issues";
import type {
  IssueWithLabels,
  Label,
  Comment,
  Activity,
  UpdateIssueInput,
} from "@/lib/types";
import type { Status, Priority } from "@/lib/design-tokens";

interface IssueDetailPanelProps {
  issue: IssueWithLabels;
  allLabels: Label[];
  onUpdate: (data: UpdateIssueInput) => void;
  onDelete: () => void;
  onAddLabel: (labelId: string) => void;
  onRemoveLabel: (labelId: string) => void;
  onClose: () => void;
  className?: string;
}

export function IssueDetailPanel({
  issue,
  allLabels,
  onUpdate,
  onDelete,
  onAddLabel,
  onRemoveLabel,
  onClose,
  className,
}: IssueDetailPanelProps) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description || "");
  const [activeTab, setActiveTab] = useState<"comments" | "activity">("comments");
  const [comments, setComments] = useState<Comment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load comments and activities
  useEffect(() => {
    getIssueComments(issue.id).then(setComments);
    getIssueActivities(issue.id).then(setActivities);
  }, [issue.id]);

  // Reset state when issue changes
  useEffect(() => {
    setTitle(issue.title);
    setDescription(issue.description || "");
  }, [issue.id, issue.title, issue.description]);

  const handleTitleBlur = () => {
    if (title.trim() && title !== issue.title) {
      onUpdate({ title: title.trim() });
    }
  };

  const handleDescriptionBlur = () => {
    if (description !== (issue.description || "")) {
      onUpdate({ description: description || undefined });
    }
  };

  const handleAddComment = async (body: string) => {
    const comment = await addComment(issue.id, body);
    setComments((prev) => [...prev, comment]);
    // Refresh activities
    getIssueActivities(issue.id).then(setActivities);
  };

  const handleUpdateComment = async (commentId: string, body: string) => {
    await updateComment(commentId, body);
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId ? { ...c, body, updatedAt: new Date() } : c
      )
    );
  };

  const handleDeleteComment = async (commentId: string) => {
    await deleteComment(commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  const handleDelete = () => {
    if (isDeleting) {
      onDelete();
    } else {
      setIsDeleting(true);
      setTimeout(() => setIsDeleting(false), 3000);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-background border-l border-border",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {issue.identifier}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
            title="Copy link"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          <button
            onClick={handleDelete}
            className={cn(
              "p-1.5 rounded text-muted-foreground transition-colors",
              isDeleting
                ? "bg-destructive/20 text-destructive hover:bg-destructive/30"
                : "hover:bg-accent hover:text-foreground"
            )}
            title={isDeleting ? "Click again to delete" : "Delete"}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 space-y-6">
          {/* Title */}
          <div>
            <TextareaAutosize
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className={cn(
                "w-full text-lg font-semibold resize-none bg-transparent",
                "border-0 focus:outline-none focus:ring-0 p-0",
                "placeholder:text-muted-foreground"
              )}
              placeholder="Issue title"
            />
          </div>

          {/* Properties */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Status
              </label>
              <StatusSelect
                value={issue.status as Status}
                onChange={(status) => onUpdate({ status })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Priority
              </label>
              <PrioritySelect
                value={issue.priority as Priority}
                onChange={(priority) => onUpdate({ priority })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Due date
              </label>
              <DatePicker
                value={issue.dueDate}
                onChange={(dueDate) => onUpdate({ dueDate: dueDate ?? undefined })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Estimate
              </label>
              <EstimateInput
                value={issue.estimate}
                onChange={(estimate) => onUpdate({ estimate: estimate ?? undefined })}
              />
            </div>
          </div>

          {/* Labels */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">
              Labels
            </label>
            <LabelSelect
              selectedLabels={issue.labels}
              availableLabels={allLabels}
              onAdd={onAddLabel}
              onRemove={onRemoveLabel}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">
              Description
            </label>
            <TextareaAutosize
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              className={cn(
                "w-full text-sm resize-none bg-muted/50 rounded-md p-3",
                "border border-transparent focus:border-border",
                "focus:outline-none focus:ring-0",
                "placeholder:text-muted-foreground"
              )}
              placeholder="Add a description..."
              minRows={3}
            />
          </div>

          {/* Tabs: Comments / Activity */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={() => setActiveTab("comments")}
                className={cn(
                  "text-sm font-medium pb-1 border-b-2 transition-colors",
                  activeTab === "comments"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Comments ({comments.length})
              </button>
              <button
                onClick={() => setActiveTab("activity")}
                className={cn(
                  "text-sm font-medium pb-1 border-b-2 transition-colors",
                  activeTab === "activity"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                Activity ({activities.length})
              </button>
            </div>

            {activeTab === "comments" ? (
              <Comments
                comments={comments}
                onAdd={handleAddComment}
                onUpdate={handleUpdateComment}
                onDelete={handleDeleteComment}
              />
            ) : (
              <ActivityFeed activities={activities} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
