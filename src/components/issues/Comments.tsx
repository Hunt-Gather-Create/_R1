"use client";

import { useState } from "react";
import { format } from "date-fns";
import TextareaAutosize from "react-textarea-autosize";
import { Trash2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Comment } from "@/lib/types";

interface CommentsProps {
  comments: Comment[];
  onAdd: (body: string) => void;
  onUpdate: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
  className?: string;
}

interface CommentItemProps {
  comment: Comment;
  onUpdate: (body: string) => void;
  onDelete: () => void;
}

function CommentItem({ comment, onUpdate, onDelete }: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(comment.body);

  const handleSave = () => {
    if (editedBody.trim() && editedBody !== comment.body) {
      onUpdate(editedBody.trim());
    }
    setIsEditing(false);
  };

  return (
    <div className="group relative py-3 border-b border-border/50 last:border-0">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-[10px] font-medium text-primary">U</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {format(new Date(comment.createdAt), "MMM d, h:mm a")}
          </span>
          {comment.updatedAt > comment.createdAt && (
            <span className="text-[10px] text-muted-foreground">(edited)</span>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 hover:bg-destructive/20 rounded text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <TextareaAutosize
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            className={cn(
              "w-full px-3 py-2 text-sm rounded-md resize-none",
              "bg-background border border-input",
              "focus:outline-none focus:ring-2 focus:ring-ring"
            )}
            minRows={2}
            autoFocus
          />
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditedBody(comment.body);
                setIsEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
      )}
    </div>
  );
}

export function Comments({
  comments,
  onAdd,
  onUpdate,
  onDelete,
  className,
}: CommentsProps) {
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    try {
      onAdd(newComment.trim());
      setNewComment("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Comment input */}
      <div className="space-y-2">
        <TextareaAutosize
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment..."
          className={cn(
            "w-full px-3 py-2 text-sm rounded-md resize-none",
            "bg-background border border-input",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            "placeholder:text-muted-foreground"
          )}
          minRows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">
            Press ⌘ + Enter to submit
          </p>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!newComment.trim() || isSubmitting}
          >
            Comment
          </Button>
        </div>
      </div>

      {/* Comment list */}
      {comments.length > 0 && (
        <div className="space-y-0">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              onUpdate={(body) => onUpdate(comment.id, body)}
              onDelete={() => onDelete(comment.id)}
            />
          ))}
        </div>
      )}

      {comments.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No comments yet
        </p>
      )}
    </div>
  );
}
