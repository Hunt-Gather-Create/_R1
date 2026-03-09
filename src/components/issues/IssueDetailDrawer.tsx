"use client";

import { useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Check, Copy, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AdArtifactDialog } from "@/components/ads/AdArtifactDialog";
import { IssueChatPanel } from "./IssueChatPanel";
import { IssueDetailForm } from "./IssueDetailForm";
import { AttachmentPreview } from "./AttachmentPreview";
import { getArtifactVersionAttachmentUrl } from "@/lib/actions/ad-artifacts";
import type { AttachmentWithUrl } from "@/lib/types";

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
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<{ id: string; version?: number } | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentWithUrl | null>(null);

  const viewArtifact = useCallback(async (artifactId: string, version?: number) => {
    setSelectedArtifact({ id: artifactId, version });
    if (version !== undefined) {
      const url = await getArtifactVersionAttachmentUrl(artifactId, version);
      if (url) {
        setPreviewAttachment({
          id: `${artifactId}-v${version}`,
          issueId: issue?.id ?? "",
          userId: null,
          filename: `Ad Preview v${version}.html`,
          storageKey: "",
          mimeType: "text/html",
          size: 0,
          createdAt: new Date(),
          url,
        });
      }
    } else {
      setPreviewAttachment(null);
    }
  }, [issue?.id]);

  const closeArtifact = useCallback(() => {
    setSelectedArtifact(null);
    setPreviewAttachment(null);
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
    setSelectedArtifact(null);
    setPreviewAttachment(null);
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

        {/* Two-column layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left: AI Chat */}
          <div className="w-[55%] border-r border-border">
            <IssueChatPanel
              issue={issue}
              onViewArtifact={viewArtifact}
            />
          </div>

          {/* Right: Issue Detail Form */}
          <div className="w-[45%]">
            <IssueDetailForm issue={issue} />
          </div>
        </div>

        {/* Current version: full-screen editable dialog */}
        {selectedArtifact && !previewAttachment && (
          <AdArtifactDialog
            open={true}
            onOpenChange={(open) => { if (!open) closeArtifact(); }}
            artifactId={selectedArtifact.id}
            issueId={issue.id}
          />
        )}

        {/* Historical version: attachment preview dialog */}
        <AttachmentPreview
          attachment={previewAttachment}
          open={!!previewAttachment}
          onOpenChange={(open) => { if (!open) { setPreviewAttachment(null); setSelectedArtifact(null); } }}
        />
      </SheetContent>
    </Sheet>
  );
}
