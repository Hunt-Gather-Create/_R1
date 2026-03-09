"use client";

import { useEffect, useRef, useState, useMemo, Suspense, type ComponentType } from "react";
import { Loader2, Maximize2, Paperclip, Check, Instagram, Video, Linkedin, Search, Facebook } from "lucide-react";
import { ArtifactProvider } from "@/components/ads/context/ArtifactProvider";
import { getTemplateEntry } from "@/components/ads/schemas";
import { getAdArtifact, linkArtifactVersionToMessage, getAdArtifactVersion } from "@/lib/actions/ad-artifacts";
import { AdArtifactPreview } from "@/components/ads/AdArtifactPreview";
import type { Artifact } from "@/components/ads/types/ArtifactData";
import type { ResolvedMediaBySlot } from "@/lib/actions/ad-artifacts";

const PLATFORM_ICONS: Record<string, typeof Instagram> = {
  instagram: Instagram,
  tiktok: Video,
  linkedin: Linkedin,
  google: Search,
  facebook: Facebook,
};

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_DURATION_MS = 180_000; // 3 minutes

interface ArtifactState {
  data: Artifact;
  type: string;
  workspaceId: string;
  resolvedMediaUrls: string[];
  resolvedMediaBySlot: ResolvedMediaBySlot;
}

interface AdArtifactInlineProps {
  artifactId: string;
  name: string;
  platform: string;
  templateType: string;
  workspaceId: string;
  messageId?: string;
  onExpand?: (version?: number) => void;
  onAttach?: () => Promise<void>;
  showPreview?: boolean;
}

export function AdArtifactInline({
  showPreview,
  artifactId,
  name,
  platform,
  templateType,
  workspaceId,
  messageId,
  onExpand,
  onAttach,
}: AdArtifactInlineProps) {
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachSuccess, setAttachSuccess] = useState(false);

  const handleAttach = async () => {
    if (!onAttach || isAttaching) return;
    setIsAttaching(true);
    try {
      await onAttach();
      setAttachSuccess(true);
      setTimeout(() => setAttachSuccess(false), 2000);
    } finally {
      setIsAttaching(false);
    }
  };

  const [artifact, setArtifact] = useState<ArtifactState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [TemplateComponent, setTemplateComponent] = useState<ComponentType | null>(null);

  // Media readiness + version tracking
  const [isMediaReady, setIsMediaReady] = useState(false);
  const [displayVersion, setDisplayVersion] = useState(0);
  // Override content/media when showing a pinned historical version
  const [displayContent, setDisplayContent] = useState<unknown>(null);
  const [displayMediaBySlot, setDisplayMediaBySlot] = useState<ResolvedMediaBySlot | null>(null);

  const isMediaReadyRef = useRef(false);
  const prevVersionRef = useRef(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);

  function checkReady(slots: ResolvedMediaBySlot, needsImages: boolean): boolean {
    if (!needsImages) return true;
    // Only check slots that have actual generated images; skip empty slots
    const activeSlots = slots.filter((s) => s.imageUrls.some(Boolean));
    if (activeSlots.length === 0) return true; // nothing was generated → ready
    return activeSlots.every((s) => s.currentImageUrl !== null);
  }

  useEffect(() => {
    let cancelled = false;

    function stopPolling() {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    function markReady(version: number) {
      isMediaReadyRef.current = true;
      setIsMediaReady(true);
      setDisplayVersion(version);
      stopPolling();
    }

    async function load() {
      setIsLoading(true);
      setError(null);
      isMediaReadyRef.current = false;

      try {
        const result = await getAdArtifact(artifactId);
        if (cancelled || !result) {
          if (!cancelled) setError("Artifact not found");
          return;
        }

        const templateTypeKey = `ad-template:${result.platform}-${result.templateType}`;
        const entry = getTemplateEntry(templateTypeKey);
        const needsImages = entry?.needsImageGeneration ?? false;

        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(result.content);
        } catch {
          parsedContent = result.content;
        }

        const artifactData: Artifact = {
          id: result.id,
          name: result.name,
          format: "ad-template",
          content: parsedContent as string,
          type: templateTypeKey,
        };

        if (!cancelled) {
          setArtifact({
            data: artifactData,
            type: templateTypeKey,
            workspaceId: result.workspaceId,
            resolvedMediaUrls: result.resolvedMediaUrls,
            resolvedMediaBySlot: result.resolvedMediaBySlot ?? [],
          });

          prevVersionRef.current = result.currentVersion ?? 0;

          // Load the template component
          if (entry) {
            const mod = await entry.component();
            if (!cancelled) setTemplateComponent(() => mod.default);
          }

          // Check for already-pinned version (older message scrolled back into view)
          if (messageId && result.versions?.length > 0) {
            const pinned = result.versions.find((v) => v.messageId === messageId);
            if (pinned && pinned.version !== result.currentVersion) {
              const versionData = await getAdArtifactVersion(artifactId, pinned.version);
              if (!cancelled && versionData) {
                let pinnedContent: unknown;
                try {
                  pinnedContent = JSON.parse(versionData.content);
                } catch {
                  pinnedContent = versionData.content;
                }
                setDisplayContent(pinnedContent);
                setDisplayMediaBySlot(versionData.resolvedMediaBySlot);
                markReady(pinned.version);
                return;
              }
            }
          }

          // Check if already ready (e.g. component re-mounted after images were generated)
          const currentVersion = result.currentVersion ?? 0;
          const ready = currentVersion > 0 && checkReady(result.resolvedMediaBySlot, needsImages);
          if (ready) {
            markReady(currentVersion);
            // Link to messageId if not already linked
            if (messageId && !result.versions?.some((v) => v.messageId === messageId)) {
              linkArtifactVersionToMessage(artifactId, currentVersion, messageId).catch(() => {});
            }
            return;
          }

          // Not ready yet — start polling
          pollStartRef.current = Date.now();
          pollIntervalRef.current = setInterval(async () => {
            if (isMediaReadyRef.current) {
              stopPolling();
              return;
            }

            // Timeout check — give up after MAX_POLL_DURATION_MS
            if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
              stopPolling();
              const r2 = await getAdArtifact(artifactId).catch(() => null);
              const latestVersion = r2?.currentVersion ?? 0;
              if (latestVersion > 0 && checkReady(r2?.resolvedMediaBySlot ?? [], needsImages)) {
                markReady(latestVersion);
              } else {
                setError("Image generation timed out. Please regenerate the ad.");
              }
              return;
            }

            try {
              const r = await getAdArtifact(artifactId);
              if (!r || isMediaReadyRef.current) return;

              const newVersion = r.currentVersion ?? 0;
              if (newVersion > prevVersionRef.current) {
                prevVersionRef.current = newVersion;

                // Update artifact state with fresh data
                let freshContent: unknown;
                try {
                  freshContent = JSON.parse(r.content);
                } catch {
                  freshContent = r.content;
                }
                const freshArtifactData: Artifact = {
                  id: r.id,
                  name: r.name,
                  format: "ad-template",
                  content: freshContent as string,
                  type: templateTypeKey,
                };
                setArtifact({
                  data: freshArtifactData,
                  type: templateTypeKey,
                  workspaceId: r.workspaceId,
                  resolvedMediaUrls: r.resolvedMediaUrls,
                  resolvedMediaBySlot: r.resolvedMediaBySlot ?? [],
                });

                markReady(newVersion);

                // Link this version to the message
                if (messageId) {
                  linkArtifactVersionToMessage(artifactId, newVersion, messageId).catch(() => {});
                }
              }
            } catch {
              // ignore poll errors
            }
          }, POLL_INTERVAL_MS);
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
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [artifactId]); // eslint-disable-line react-hooks/exhaustive-deps

  const PlatformIcon = PLATFORM_ICONS[platform] || Instagram;

  // Compute display artifact (pinned version content overrides current)
  const displayArtifact = useMemo(() => {
    if (!artifact) return null;
    if (displayContent !== null) {
      // content is typed as string but holds parsed JSON (same pattern as ArtifactProvider)
      return { ...artifact, data: { ...artifact.data, content: displayContent as string } };
    }
    return artifact;
  }, [artifact, displayContent]);

  const displayMedia = displayMediaBySlot ?? artifact?.resolvedMediaBySlot ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 w-full max-w-sm mt-3 p-3 rounded-lg bg-background/50 border border-border/50">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted border border-border text-muted-foreground">
          <PlatformIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{name}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading preview…
          </p>
        </div>
      </div>
    );
  }

  if (error || !displayArtifact || showPreview) {
    return (
      <AdArtifactPreview
        name={name}
        platform={platform}
        templateType={templateType}
        onView={() => onExpand?.(displayVersion || undefined)}
      />
    );
  }

  if (!isMediaReady) {
    return (
      <div className="flex items-center gap-3 w-full max-w-sm mt-3 p-3 rounded-lg bg-background/50 border border-border/50">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted border border-border text-muted-foreground">
          <PlatformIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{name}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Generating…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 mb-3 max-w-fit mx-auto">
      <ArtifactProvider
        artifact={displayArtifact.data}
        name={displayArtifact.data.name}
        artifactId={displayArtifact.data.id}
        workspaceId={workspaceId}
        mediaUrls={displayMedia}
        enableGenerate={false}
        onRegenerate={() => {}}
        onSave={() => {}}
      >
        <div className="w-full bg-background/50 border border-border/50 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
            <div className="flex items-center gap-2 min-w-0">
              <PlatformIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium truncate">{displayArtifact.data.name}</span>
              {displayVersion > 0 && (
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                  v{displayVersion}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              {onAttach && (
                <button
                  onClick={handleAttach}
                  disabled={isAttaching || attachSuccess}
                  className="p-1 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                  title={attachSuccess ? "Attached!" : "Attach to issue"}
                >
                  {isAttaching ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  ) : attachSuccess ? (
                    <Check className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
              )}
              {onExpand && (
                <button
                  onClick={() => onExpand(displayVersion || undefined)}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                  title="Expand"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Template preview */}
          <div className="overflow-hidden">
            {TemplateComponent ? (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center p-6">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <TemplateComponent />
              </Suspense>
            ) : (
              <div className="p-3 text-xs text-muted-foreground">
                Template not found for type: {displayArtifact.type}
              </div>
            )}
          </div>
        </div>
      </ArtifactProvider>
    </div>
  );
}
