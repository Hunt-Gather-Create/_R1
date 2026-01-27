"use client";

import { useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Check, Copy, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSendToAI } from "@/lib/hooks";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { IssueChatPanel } from "./IssueChatPanel";
import { IssueDetailForm } from "./IssueDetailForm";
import type { Comment } from "@/lib/types";

interface IssueDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IssueDetailDrawer({
  open,
  onOpenChange,
}: IssueDetailDrawerProps) {
  const { selectedIssue: issue, deleteSelectedIssue } = useBoardContext();
  const pathname = usePathname();
  const { sendToAI } = useSendToAI();
  const [comments, setComments] = useState<Comment[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [externalDescription, setExternalDescription] = useState<
    string | undefined
  >(undefined);
  const [highlightDescription, setHighlightDescription] = useState(false);

  const handleCommentsLoad = useCallback((loadedComments: Comment[]) => {
    setComments(loadedComments);
  }, []);

  const handleUpdateDescription = useCallback((description: string) => {
    setExternalDescription(description);
    setHighlightDescription(true);
    // Reset highlight state after animation
    setTimeout(() => setHighlightDescription(false), 2000);
  }, []);

  const handleCopyLink = useCallback(() => {
    if (!issue) return;
    const url = `${window.location.origin}${pathname}?issue=${issue.identifier}`;
    navigator.clipboard.writeText(url).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  }, [pathname, issue]);

  const handleDelete = () => {
    if (isDeleting) {
      deleteSelectedIssue();
      onOpenChange(false);
    } else {
      setIsDeleting(true);
      setTimeout(() => setIsDeleting(false), 3000);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setIsDeleting(false);
    setExternalDescription(undefined);
  };

  if (!issue) return null;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        className="w-[85vw] max-w-[1400px] sm:max-w-[1400px] p-0 flex flex-col"
        hideCloseButton
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-6 border-b border-border shrink-0">
          <SheetTitle className="text-base font-semibold">
            {issue.identifier}
          </SheetTitle>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopyLink}
              className={cn(
                "p-1.5 rounded transition-colors",
                isCopied
                  ? "bg-green-500/20 text-green-500"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              title={isCopied ? "Copied!" : "Copy link"}
            >
              {isCopied ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => sendToAI(issue.id)}
              className={cn(
                "p-1.5 rounded transition-colors",
                issue.sentToAI
                  ? "bg-blue-500/20 text-blue-500"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              title="Send to AI"
            >
              <Sparkles className="w-4 h-4" />
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
              onClick={handleClose}
              className="p-1.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content - Two column layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left: AI Chat */}
          <div className="w-[55%] border-r border-border">
            <IssueChatPanel
              issue={issue}
              comments={comments}
              onUpdateDescription={handleUpdateDescription}
            />
          </div>

          {/* Right: Issue Form */}
          <div className="w-[45%]">
            <IssueDetailForm
              issue={issue}
              externalDescription={externalDescription}
              highlightDescription={highlightDescription}
              onCommentsLoad={handleCommentsLoad}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
