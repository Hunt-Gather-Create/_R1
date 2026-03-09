"use client";

import { useContext, useEffect, useRef, useState, useCallback, Suspense, type ComponentType, type RefObject } from "react";
import { X, Loader2, Minimize2, Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArtifactProvider } from "@/components/ads/context/ArtifactProvider";
import ArtifactControlsBar from "@/components/ads/components/ArtifactControlsBar";
import { AdContentEditForm } from "@/components/ads/components/AdContentEditForm";
import { getTemplateEntry } from "@/components/ads/schemas";
import { getAdArtifact, getAdArtifactVersion } from "@/lib/actions/ad-artifacts";
import { saveArtifactAsChatAttachment } from "@/lib/actions/workspace-chat";
import { attachAdArtifactToIssue } from "@/lib/actions/ad-artifacts";
import { ChatContext } from "@/app/w/[slug]/chat/_components/ChatContext";
import { queryKeys } from "@/lib/query-keys";
import { useArtifactContext } from "@/components/ads/context/ArtifactProvider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Artifact } from "@/components/ads/types/ArtifactData";

interface AdArtifactPanelContentProps {
  artifactId: string;
  artifactName: string;
  artifactType: string;
  TemplateComponent: ComponentType | null;
  containerRef: RefObject<HTMLDivElement | null>;
  templateRef: RefObject<HTMLDivElement | null>;
  scale: number;
  onSaveAsAttachment: () => Promise<void>;
  isSavingAsAttachment: boolean;
  saveAttachmentDisabled: boolean;
  saveAttachmentTitle: string;
  saveError: string | null;
  onCollapseToInline?: () => void;
  onClose: () => void;
  readOnly?: boolean;
}

function AdArtifactPanelContent({
  artifactId,
  artifactName,
  artifactType,
  TemplateComponent,
  containerRef,
  templateRef,
  scale,
  onSaveAsAttachment,
  isSavingAsAttachment,
  saveAttachmentDisabled,
  saveAttachmentTitle,
  saveError,
  onCollapseToInline,
  onClose,
  readOnly,
}: AdArtifactPanelContentProps) {
  const { localContent, updateContent, saveContent, isSavingContent } = useArtifactContext();
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const originalContentRef = useRef<unknown>(null);

  const handleEditStart = () => {
    originalContentRef.current = localContent;
    setEditError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    updateContent(originalContentRef.current);
    setIsEditing(false);
    setEditError(null);
  };

  const handleSave = async () => {
    setEditError(null);
    try {
      await saveContent(artifactId);
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const previewNode = (
    <div ref={containerRef} className="flex-1 overflow-hidden p-4 flex items-start justify-center min-w-0">
      <div
        ref={templateRef}
        className="bg-muted/30 border border-border rounded-lg pb-6 shrink-0"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top center",
        }}
      >
        {TemplateComponent ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <TemplateComponent />
          </Suspense>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Template not found for type: {artifactType}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-medium truncate min-w-0" title={artifactName}>
            {artifactName}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isEditing && (
            <ArtifactControlsBar
              variant="header"
              showTitle={false}
              showMediaCount={true}
              onSaveAsAttachment={onSaveAsAttachment}
              isSavingAsAttachment={isSavingAsAttachment}
              saveAttachmentDisabled={saveAttachmentDisabled}
              saveAttachmentTitle={saveAttachmentTitle}
            />
          )}
          {!readOnly && (
            isEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isSavingContent}
                  className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSavingContent}
                  className="px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {isSavingContent && <Loader2 className="w-3 h-3 animate-spin" />}
                  Save
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleEditStart}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                title="Edit content"
              >
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </button>
            )
          )}
          {onCollapseToInline && !isEditing && (
            <button
              type="button"
              onClick={onCollapseToInline}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
              title="Collapse to inline"
            >
              <Minimize2 className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {(saveError || editError) && (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/10 border-b border-border">
          {saveError || editError}
        </div>
      )}

      {/* Content */}
      {isEditing ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Edit form */}
          <div className="w-[360px] shrink-0 border-r border-border overflow-y-auto p-4 space-y-3">
            <AdContentEditForm
              content={localContent}
              onChange={updateContent}
            />
          </div>
          {/* Live preview */}
          {previewNode}
        </div>
      ) : (
        previewNode
      )}
    </>
  );
}

interface AdArtifactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactId: string;
  issueId?: string;
  initialVersion?: number;
  onCollapseToInline?: () => void;
  readOnly?: boolean;
}

export function AdArtifactDialog({ open, onOpenChange, artifactId, issueId, initialVersion, onCollapseToInline, readOnly }: AdArtifactDialogProps) {
  const chatContext = useContext(ChatContext);
  const selectedChatId = chatContext?.selectedChatId ?? null;
  const viewAttachment = chatContext?.viewAttachment;
  const queryClient = useQueryClient();
  const [isSavingAsAttachment, setIsSavingAsAttachment] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSaveAsAttachment = useCallback(async () => {
    if (issueId) {
      // Issue chat: attach to issue
      setIsSavingAsAttachment(true);
      setSaveError(null);
      try {
        const result = await attachAdArtifactToIssue(artifactId, issueId);
        if (!result.success) {
          setSaveError(result.error);
        }
      } finally {
        setIsSavingAsAttachment(false);
      }
      return;
    }

    // Workspace chat: save as chat attachment
    if (!selectedChatId) return;
    setIsSavingAsAttachment(true);
    setSaveError(null);
    try {
      const result = await saveArtifactAsChatAttachment(artifactId, selectedChatId);
      if (result.success) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.workspaceChat.attachments(selectedChatId),
        });
        viewAttachment?.(result.attachmentId);
      } else {
        setSaveError(result.error);
      }
    } finally {
      setIsSavingAsAttachment(false);
    }
  }, [artifactId, issueId, selectedChatId, queryClient, viewAttachment]);

  const [artifact, setArtifact] = useState<{
    data: Artifact;
    type: string;
    workspaceId: string;
    resolvedMediaUrls: string[];
    resolvedMediaBySlot: Array<{
      imageUrls: string[];
      videoUrls: string[];
      currentIndex: number;
      currentImageUrl: string | null;
      generatedAt: Date;
      showVideo: boolean;
    }>;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [TemplateComponent, setTemplateComponent] = useState<ComponentType | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);

  useEffect(() => {
    const container = containerRef.current;
    const template = templateRef.current;
    if (!container || !template) return;

    const updateScale = () => {
      const cRect = container.getBoundingClientRect();
      const tRect = template.getBoundingClientRect();
      // Divide out current scale to get natural dimensions
      const currentScale = scaleRef.current;
      const naturalW = tRect.width / currentScale;
      const naturalH = tRect.height / currentScale;
      if (naturalW === 0 || naturalH === 0) return;
      const availW = cRect.width - 32; // p-4 padding on each side
      const availH = cRect.height - 32;
      const newScale = Math.min(availW / naturalW, availH / naturalH, 1);
      if (Math.abs(newScale - currentScale) > 0.001) {
        scaleRef.current = newScale;
        setScale(newScale);
      }
    };

    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    observer.observe(template);
    return () => observer.disconnect();
  }, [artifact, TemplateComponent]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch artifact metadata (always needed for platform/templateType/name/workspaceId)
        const result = await getAdArtifact(artifactId);
        if (cancelled || !result) {
          if (!cancelled) setError("Artifact not found");
          return;
        }

        const templateType = `ad-template:${result.platform}-${result.templateType}`;
        const entry = getTemplateEntry(templateType);

        // Determine content + media: use pinned version if provided
        let content = result.content;
        let resolvedMediaBySlot = result.resolvedMediaBySlot ?? [];

        if (initialVersion !== undefined && initialVersion !== result.currentVersion) {
          const versionData = await getAdArtifactVersion(artifactId, initialVersion);
          if (versionData) {
            content = versionData.content;
            resolvedMediaBySlot = versionData.resolvedMediaBySlot;
          }
        }

        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(content);
        } catch {
          parsedContent = content;
        }

        const artifactData: Artifact = {
          id: result.id,
          name: result.name,
          format: "ad-template",
          content: parsedContent as string,
          type: templateType,
        };

        if (!cancelled) {
          setArtifact({
            data: artifactData,
            type: templateType,
            workspaceId: result.workspaceId,
            resolvedMediaUrls: result.resolvedMediaUrls,
            resolvedMediaBySlot,
          });

          if (entry) {
            const mod = await entry.component();
            if (!cancelled) {
              setTemplateComponent(() => mod.default);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load artifact");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [artifactId, open, initialVersion]);

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col inset-4 w-auto h-auto !max-w-none translate-x-0 translate-y-0 rounded-lg p-0 gap-0" showCloseButton={false}>
          <DialogTitle className="sr-only">Ad preview</DialogTitle>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm text-muted-foreground">Loading ad...</span>
            <button onClick={() => onOpenChange(false)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (error || !artifact) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col inset-4 w-auto h-auto !max-w-none translate-x-0 translate-y-0 rounded-lg p-0 gap-0" showCloseButton={false}>
          <DialogTitle className="sr-only">Ad preview</DialogTitle>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm text-red-500">Error</span>
            <button onClick={() => onOpenChange(false)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-sm text-muted-foreground">{error || "Artifact not found"}</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col inset-4 w-auto h-auto !max-w-none translate-x-0 translate-y-0 rounded-lg p-0 gap-0" showCloseButton={false}>
        <DialogTitle className="sr-only">{artifact.data.name ?? "Ad preview"}</DialogTitle>
        <ArtifactProvider
          artifact={artifact.data}
          name={artifact.data.name}
          artifactId={artifact.data.id}
          workspaceId={artifact.workspaceId}
          mediaUrls={artifact.resolvedMediaBySlot}
          enableGenerate={false}
          onRegenerate={() => {}}
          onSave={() => {}}
        >
          <AdArtifactPanelContent
            artifactId={artifact.data.id}
            artifactName={artifact.data.name}
            artifactType={artifact.type}
            TemplateComponent={TemplateComponent}
            containerRef={containerRef}
            templateRef={templateRef}
            scale={scale}
            onSaveAsAttachment={handleSaveAsAttachment}
            isSavingAsAttachment={isSavingAsAttachment}
            saveAttachmentDisabled={!selectedChatId && !issueId}
            saveAttachmentTitle={issueId ? "Attach to issue" : selectedChatId ? "Save as attachment" : "Select a chat to save as attachment"}
            saveError={saveError}
            onCollapseToInline={
              onCollapseToInline
                ? () => { onCollapseToInline(); onOpenChange(false); }
                : undefined
            }
            onClose={() => onOpenChange(false)}
            readOnly={readOnly}
          />
        </ArtifactProvider>
      </DialogContent>
    </Dialog>
  );
}
