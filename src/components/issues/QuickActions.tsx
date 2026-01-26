"use client";

import { cn } from "@/lib/utils";
import {
  MoreHorizontal,
  Copy,
  Trash2,
  ExternalLink,
  Archive,
  Sparkles,
} from "lucide-react";

interface QuickActionsProps {
  onOpen?: () => void;
  onCopy?: () => void;
  onArchive?: () => void;
  onSendToAI?: () => void;
  onDelete?: () => void;
  className?: string;
}

export function QuickActions({
  onOpen,
  onCopy,
  onArchive,
  onSendToAI,
  onDelete,
  className,
}: QuickActionsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity",
        className
      )}
    >
      {onOpen && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Open in new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      )}
      {onCopy && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Copy link"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}
      {onArchive && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Archive"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>
      )}
      {onSendToAI && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSendToAI();
          }}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Send to AI"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      )}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// Kebab menu for more actions
export function IssueMenu({
  onEdit,
  onCopyId,
  onCopyLink,
  onDelete,
  className,
}: {
  onEdit?: () => void;
  onCopyId?: () => void;
  onCopyLink?: () => void;
  onDelete?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors",
        "opacity-0 group-hover:opacity-100",
        className
      )}
      title="More actions"
    >
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );
}
