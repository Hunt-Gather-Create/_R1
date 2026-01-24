"use client";

import { useState, useEffect } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { cn } from "@/lib/utils";
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

interface IssueDetailFormProps {
  issue: IssueWithLabels;
  allLabels: Label[];
  onUpdate: (data: UpdateIssueInput) => void;
  onAddLabel: (labelId: string) => void;
  onRemoveLabel: (labelId: string) => void;
  onCreateLabel?: (name: string, color: string) => Promise<Label | undefined>;
  // For syncing with external description changes (e.g., from AI)
  externalDescription?: string;
  highlightDescription?: boolean;
  onCommentsLoad?: (comments: Comment[]) => void;
}

export function IssueDetailForm({
  issue,
  allLabels,
  onUpdate,
  onAddLabel,
  onRemoveLabel,
  onCreateLabel,
  externalDescription,
  highlightDescription = false,
  onCommentsLoad,
}: IssueDetailFormProps) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description || "");
  const [activeTab, setActiveTab] = useState<"comments" | "activity">(
    "comments"
  );
  const [comments, setComments] = useState<Comment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [descriptionHighlight, setDescriptionHighlight] = useState(false);

  // Load comments and activities
  useEffect(() => {
    getIssueComments(issue.id).then((loadedComments) => {
      setComments(loadedComments);
      onCommentsLoad?.(loadedComments);
    });
    getIssueActivities(issue.id).then(setActivities);
  }, [issue.id, onCommentsLoad]);

  // Reset state when issue changes
  useEffect(() => {
    setTitle(issue.title);
    setDescription(issue.description || "");
  }, [issue.id, issue.title, issue.description]);

  // Handle external description updates (from AI)
  useEffect(() => {
    if (
      externalDescription !== undefined &&
      externalDescription !== description
    ) {
      setDescription(externalDescription);
      setDescriptionHighlight(true);
      // Persist the update
      onUpdate({ description: externalDescription || undefined });
      // Clear highlight after animation
      setTimeout(() => setDescriptionHighlight(false), 2000);
    }
  }, [externalDescription]);

  // Also highlight when prop changes
  useEffect(() => {
    if (highlightDescription) {
      setDescriptionHighlight(true);
      setTimeout(() => setDescriptionHighlight(false), 2000);
    }
  }, [highlightDescription]);

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
    const newComments = [...comments, comment];
    setComments(newComments);
    onCommentsLoad?.(newComments);
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
    const newComments = comments.filter((c) => c.id !== commentId);
    setComments(newComments);
    onCommentsLoad?.(newComments);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <h3 className="text-sm font-medium">Issue Details</h3>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 space-y-6">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">
              Title
            </label>
            <TextareaAutosize
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className={cn(
                "w-full text-lg font-semibold resize-none bg-muted/50 rounded-md p-3",
                "border border-transparent focus:border-border",
                "focus:outline-none focus:ring-0",
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
                onChange={(dueDate) =>
                  onUpdate({ dueDate: dueDate ?? undefined })
                }
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Estimate
              </label>
              <EstimateInput
                value={issue.estimate}
                onChange={(estimate) =>
                  onUpdate({ estimate: estimate ?? undefined })
                }
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
              onCreateLabel={onCreateLabel}
            />
          </div>

          {/* Description */}
          <div
            className={cn(
              "transition-all duration-500 rounded-md",
              descriptionHighlight &&
                "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
          >
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
