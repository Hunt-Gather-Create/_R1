"use client";

import { useState, useEffect, useCallback } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "@/components/ui/markdown-editor";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { DescriptionEditorDialog } from "./DescriptionEditorDialog";

import { StatusSelect } from "./properties/StatusSelect";
import { PrioritySelect } from "./properties/PrioritySelect";
import { AssigneeSelect } from "./properties/AssigneeSelect";
import { LabelSelect } from "./properties/LabelSelect";
import { DatePicker } from "./properties/DatePicker";
import { EstimateInput } from "./properties/EstimateInput";
import { EpicBadge } from "./EpicBadge";
import { Comments } from "./Comments";
import { ActivityFeed } from "./ActivityFeed";
import { SubtaskList } from "./SubtaskList";
import { SubtaskProgress } from "./SubtaskProgress";
import { AttachmentList } from "./AttachmentList";
import { IssueKnowledgeLinks } from "./IssueKnowledgeLinks";
import {
  useIssueComments,
  useIssueActivities,
  useAddComment,
  useUpdateComment,
  useDeleteComment,
  useSubtaskCount,
  useWorkspaceMembers,
} from "@/lib/hooks";
import type { IssueWithLabels, Comment } from "@/lib/types";
import type { Priority } from "@/lib/design-tokens";

interface IssueDetailFormProps {
  issue: IssueWithLabels;
  // For syncing with external description changes (e.g., from AI)
  externalDescription?: string;
  highlightDescription?: boolean;
  onCommentsLoad?: (comments: Comment[]) => void;
}

export function IssueDetailForm({
  issue,
  externalDescription,
  highlightDescription = false,
  onCommentsLoad,
}: IssueDetailFormProps) {
  const {
    board,
    workspaceId,
    labels,
    updateSelectedIssue,
    moveSelectedIssueToColumn,
    addLabelToSelectedIssue,
    removeLabelFromSelectedIssue,
    createLabel,
  } = useBoardContext();

  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  const epicTitle = issue.epicId
    ? board.epics?.find((e) => e.id === issue.epicId)?.title ?? null
    : null;
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description || "");
  const [isDescriptionDialogOpen, setIsDescriptionDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"comments" | "activity">(
    "comments"
  );
  const [descriptionHighlight, setDescriptionHighlight] = useState(false);

  // Track previous values to detect changes during render (rerender-derived-state-no-effect rule)
  const [prevIssueId, setPrevIssueId] = useState(issue.id);
  const [prevExternalDescription, setPrevExternalDescription] = useState(externalDescription);
  const [prevHighlightDescription, setPrevHighlightDescription] = useState(highlightDescription);

  // Reset state during render when issue changes (not in effect)
  if (prevIssueId !== issue.id) {
    setPrevIssueId(issue.id);
    setTitle(issue.title);
    setDescription(issue.description || "");
    setIsDescriptionDialogOpen(false);
  }

  // Handle external description updates during render (from AI)
  if (
    externalDescription !== undefined &&
    externalDescription !== prevExternalDescription
  ) {
    setPrevExternalDescription(externalDescription);
    if (externalDescription !== description) {
      setDescription(externalDescription);
      setDescriptionHighlight(true);
      // Persist the update - schedule for after render
      setTimeout(() => {
        updateSelectedIssue({ description: externalDescription || undefined });
      }, 0);
      // Clear highlight after animation
      setTimeout(() => setDescriptionHighlight(false), 2000);
    }
  }

  // Handle highlight prop changes during render
  if (highlightDescription && highlightDescription !== prevHighlightDescription) {
    setPrevHighlightDescription(highlightDescription);
    setDescriptionHighlight(true);
    setTimeout(() => setDescriptionHighlight(false), 2000);
  } else if (!highlightDescription && prevHighlightDescription) {
    setPrevHighlightDescription(highlightDescription);
  }

  // Use TanStack Query hooks for comments and activities
  const { data: comments = [] } = useIssueComments(issue.id);
  const { data: activities = [] } = useIssueActivities(issue.id);

  // Subtask count for header (only for parent issues, not subtasks)
  const isSubtask = !!issue.parentIssueId;
  const { data: subtaskCount } = useSubtaskCount(isSubtask ? null : issue.id);
  const addCommentMutation = useAddComment(issue.id);
  const updateCommentMutation = useUpdateComment(issue.id);
  const deleteCommentMutation = useDeleteComment(issue.id);

  // Notify parent when comments load (this effect is ok - it's calling a callback, not updating local state)
  useEffect(() => {
    if (comments.length > 0) {
      onCommentsLoad?.(comments);
    }
  }, [comments, onCommentsLoad]);

  const handleTitleBlur = () => {
    if (title.trim() && title !== issue.title) {
      updateSelectedIssue({ title: title.trim() });
    }
  };

  const handleDescriptionSave = useCallback(() => {
    if (description !== (issue.description || "")) {
      updateSelectedIssue({ description: description || undefined });
    }
  }, [description, issue.description, updateSelectedIssue]);

  const handleAddComment = async (body: string) => {
    await addCommentMutation.mutateAsync(body);
  };

  const handleUpdateComment = async (commentId: string, body: string) => {
    await updateCommentMutation.mutateAsync({ commentId, body });
  };

  const handleDeleteComment = async (commentId: string) => {
    await deleteCommentMutation.mutateAsync(commentId);
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
                value={issue.columnId}
                columns={board.columns}
                onColumnChange={moveSelectedIssueToColumn}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Priority
              </label>
              <PrioritySelect
                value={issue.priority as Priority}
                onChange={(priority) => updateSelectedIssue({ priority })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Due date
              </label>
              <DatePicker
                value={issue.dueDate}
                onChange={(dueDate) =>
                  updateSelectedIssue({ dueDate: dueDate ?? undefined })
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
                  updateSelectedIssue({ estimate: estimate ?? undefined })
                }
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Assignee
              </label>
              <AssigneeSelect
                value={issue.assigneeId ?? null}
                members={members}
                onChange={(assigneeId) =>
                  updateSelectedIssue({ assigneeId })
                }
              />
            </div>
            {epicTitle ? (
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Epic
                </label>
                <div className="py-1.5">
                  <EpicBadge title={epicTitle} />
                </div>
              </div>
            ) : null}
          </div>

          {/* Labels */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">
              Labels
            </label>
            <LabelSelect
              selectedLabels={issue.labels}
              availableLabels={labels}
              onAdd={addLabelToSelectedIssue}
              onRemove={removeLabelFromSelectedIssue}
              onCreateLabel={createLabel}
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
            <div
              onClick={() => setIsDescriptionDialogOpen(true)}
              className={cn(
                "min-h-[120px] max-h-[300px] overflow-y-auto rounded-md border border-border bg-muted/30 cursor-text group relative",
                "hover:border-muted-foreground/50 transition-colors scrollbar-thin"
              )}
            >
              {description ? (
                <div className="p-3">
                  <MarkdownPreview content={description} />
                </div>
              ) : (
                <div className="p-3 text-muted-foreground text-sm">
                  Click to add a description...
                </div>
              )}
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="p-1.5 bg-muted rounded-md">
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            </div>
          </div>

          {/* Description Editor Dialog */}
          <DescriptionEditorDialog
            open={isDescriptionDialogOpen}
            onOpenChange={setIsDescriptionDialogOpen}
            value={description}
            onChange={setDescription}
            onClose={handleDescriptionSave}
          />

          {/* Subtasks - only show for parent issues (not subtasks) */}
          {!isSubtask && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Subtasks
                </label>
                {subtaskCount && subtaskCount.total > 0 && (
                  <SubtaskProgress count={subtaskCount} size="sm" />
                )}
              </div>
              <SubtaskList issue={issue} />
            </div>
          )}

          {/* Attachments */}
          <IssueKnowledgeLinks issueId={issue.id} workspaceId={workspaceId} />

          {/* Attachments */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">
              Attachments
            </label>
            <AttachmentList issue={issue} />
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
