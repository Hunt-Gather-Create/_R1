"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { useSettingsContext } from "../context";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import {
  getWorkspaceAudiences,
  getAudienceWithMembers,
  deleteAudience,
} from "@/lib/actions/audience";
import { getWorkspaceBrand, type BrandWithLogoUrl } from "@/lib/actions/brand";
import type { Audience, AudienceWithMembers } from "@/lib/types";

// Dynamic imports for components
const AudienceNoBrand = dynamic(
  () =>
    import("./_components/AudienceNoBrand").then((mod) => mod.AudienceNoBrand),
  { ssr: false }
);

const AudienceEmpty = dynamic(
  () =>
    import("./_components/AudienceEmpty").then((mod) => mod.AudienceEmpty),
  { ssr: false }
);

const AudienceGenerating = dynamic(
  () =>
    import("./_components/AudienceGenerating").then(
      (mod) => mod.AudienceGenerating
    ),
  { ssr: false }
);

const AudienceGrid = dynamic(
  () =>
    import("./_components/AudienceGrid").then((mod) => mod.AudienceGrid),
  { ssr: false }
);

const CreateAudienceDialog = dynamic(
  () =>
    import("./_components/CreateAudienceDialog").then(
      (mod) => mod.CreateAudienceDialog
    ),
  { ssr: false }
);

type PageState = "loading" | "no-brand" | "empty" | "generating" | "list";

export default function AudienceSettingsPage() {
  const { workspace, currentUserId } = useSettingsContext();
  const [state, setState] = useState<PageState>("loading");
  const [brand, setBrand] = useState<BrandWithLogoUrl | null>(null);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [selectedAudience, setSelectedAudience] =
    useState<AudienceWithMembers | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial data
  const loadData = useCallback(async () => {
    if (!currentUserId || !workspace?.id) return;

    setState("loading");
    setError(null);

    try {
      // Check if brand is configured
      const wsBrand = await getWorkspaceBrand(workspace.id);
      setBrand(wsBrand);

      if (!wsBrand) {
        setState("no-brand");
        return;
      }

      // Load audiences
      const wsAudiences = await getWorkspaceAudiences(workspace.id);
      setAudiences(wsAudiences);

      // Check if any audience is generating
      const generatingAudience = wsAudiences.find(
        (a) =>
          a.generationStatus === "pending" || a.generationStatus === "processing"
      );

      if (generatingAudience) {
        // Load the generating audience with members
        const audienceWithMembers = await getAudienceWithMembers(
          generatingAudience.id
        );
        setSelectedAudience(audienceWithMembers);
        setState("generating");
      } else if (wsAudiences.length > 0) {
        // Load first audience with members
        const audienceWithMembers = await getAudienceWithMembers(
          wsAudiences[0].id
        );
        setSelectedAudience(audienceWithMembers);
        setState("list");
      } else {
        setState("empty");
      }
    } catch (err) {
      console.error("Failed to load audience data:", err);
      setError("Failed to load audience data");
      setState("empty");
    }
  }, [currentUserId, workspace?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll for generation status updates
  useEffect(() => {
    if (state !== "generating" || !selectedAudience) return;

    const pollInterval = setInterval(async () => {
      try {
        const updated = await getAudienceWithMembers(selectedAudience.id);
        if (!updated) {
          clearInterval(pollInterval);
          loadData();
          return;
        }

        setSelectedAudience(updated);

        if (
          updated.generationStatus === "completed" ||
          updated.generationStatus === "failed"
        ) {
          clearInterval(pollInterval);
          // Reload all data
          loadData();
        }
      } catch (err) {
        console.error("Failed to poll audience status:", err);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [state, selectedAudience, loadData]);

  // Handle audience selection
  const handleSelectAudience = async (audienceId: string) => {
    try {
      const audienceWithMembers = await getAudienceWithMembers(audienceId);
      setSelectedAudience(audienceWithMembers);

      if (
        audienceWithMembers?.generationStatus === "pending" ||
        audienceWithMembers?.generationStatus === "processing"
      ) {
        setState("generating");
      } else {
        setState("list");
      }
    } catch (err) {
      console.error("Failed to load audience:", err);
      setError("Failed to load audience");
    }
  };

  // Handle audience creation
  const handleAudienceCreated = async (audience: Audience) => {
    setIsCreateDialogOpen(false);
    setAudiences((prev) => [...prev, audience]);
    const audienceWithMembers = await getAudienceWithMembers(audience.id);
    setSelectedAudience(audienceWithMembers);
    setState("generating");
  };

  // Handle audience deletion
  const handleDeleteAudience = async (audienceId: string) => {
    setIsDeleting(true);
    try {
      await deleteAudience(audienceId);
      setAudiences((prev) => prev.filter((a) => a.id !== audienceId));

      if (selectedAudience?.id === audienceId) {
        setSelectedAudience(null);
      }

      // Reload to get correct state
      loadData();
    } catch (err) {
      console.error("Failed to delete audience:", err);
      setError("Failed to delete audience");
    } finally {
      setIsDeleting(false);
    }
  };

  // Page color based on brand
  const pageColor = brand?.primaryColor || "#8b5cf6";

  // Render loading state
  if (state === "loading") {
    return (
      <GradientPage color={pageColor}>
        <PageHeader label="Marketing" title="Audience" />
        <div className="container py-8 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      </GradientPage>
    );
  }

  // Render no-brand state
  if (state === "no-brand") {
    return (
      <GradientPage color={pageColor}>
        <PageHeader
          label="Marketing"
          title="Audience"
          subtitle="Create virtual audience members for content testing"
        />
        <div className="container py-8">
          <AudienceNoBrand />
        </div>
      </GradientPage>
    );
  }

  // Render empty state
  if (state === "empty") {
    return (
      <GradientPage color={pageColor}>
        <PageHeader
          label="Marketing"
          title="Audience"
          subtitle="Create virtual audience members for content testing"
        />
        <div className="container py-8">
          <AudienceEmpty onCreateClick={() => setIsCreateDialogOpen(true)} />
          {workspace?.id && (
            <CreateAudienceDialog
              workspaceId={workspace.id}
              open={isCreateDialogOpen}
              onOpenChange={setIsCreateDialogOpen}
              onCreated={handleAudienceCreated}
            />
          )}
        </div>
      </GradientPage>
    );
  }

  // Render generating state
  if (state === "generating" && selectedAudience) {
    return (
      <GradientPage color={pageColor}>
        <PageHeader
          label="Marketing"
          title={selectedAudience.name}
          subtitle={selectedAudience.description || "Generating audience..."}
        />
        <div className="container py-8">
          <AudienceGenerating
            audience={selectedAudience}
            members={selectedAudience.members}
          />
        </div>
      </GradientPage>
    );
  }

  // Render list state
  return (
    <GradientPage
      color={pageColor}
      actions={
        <Button
          onClick={() => setIsCreateDialogOpen(true)}
          size="sm"
          className="gap-1"
        >
          <Plus className="w-4 h-4" />
          New Audience
        </Button>
      }
    >
      <PageHeader
        label="Marketing"
        title={selectedAudience?.name || "Audience"}
        subtitle={
          selectedAudience?.description ||
          "Create virtual audience members for content testing"
        }
      />
      <div className="container py-8">
        {error && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
            {error}
          </div>
        )}

        {/* Audience selector (if multiple audiences) */}
        {audiences.length > 1 && (
          <div className="flex gap-2 mb-6 flex-wrap">
            {audiences.map((audience) => (
              <Button
                key={audience.id}
                variant={
                  selectedAudience?.id === audience.id ? "default" : "outline"
                }
                size="sm"
                onClick={() => handleSelectAudience(audience.id)}
              >
                {audience.name}
                <span className="ml-1 text-xs opacity-70">
                  ({audience.memberCount})
                </span>
              </Button>
            ))}
          </div>
        )}

        {selectedAudience && (
          <AudienceGrid
            members={selectedAudience.members}
            onDelete={() => handleDeleteAudience(selectedAudience.id)}
            isDeleting={isDeleting}
          />
        )}
      </div>

      {workspace?.id && (
        <CreateAudienceDialog
          workspaceId={workspace.id}
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          onCreated={handleAudienceCreated}
        />
      )}
    </GradientPage>
  );
}
