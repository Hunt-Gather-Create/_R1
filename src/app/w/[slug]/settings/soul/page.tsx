"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { useSettingsContext } from "../context";
import { GradientPage } from "@/components/ui/gradient-page";

// Dynamic imports for heavy components - only loaded based on page state
const SoulEmptyState = dynamic(
  () =>
    import("./_components/SoulEmptyState").then((mod) => mod.SoulEmptyState),
  { ssr: false }
);

const SoulChat = dynamic(
  () => import("./_components/SoulChat").then((mod) => mod.SoulChat),
  { ssr: false }
);

const SoulPreview = dynamic(
  () => import("./_components/SoulPreview").then((mod) => mod.SoulPreview),
  { ssr: false }
);
import { PageHeader } from "@/components/ui/page-header";
import { getSoul, updateSoul } from "@/lib/actions/soul";
import { createDefaultSoul } from "@/lib/soul-formatters";
import type { WorkspaceSoul } from "@/lib/types";

type ViewMode = "view" | "edit";

export default function SoulSettingsPage() {
  const { workspace, isAdmin, brand } = useSettingsContext();
  const [soul, setSoul] = useState<WorkspaceSoul | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);
  const [hasStarted, setHasStarted] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("view");

  // Load existing soul
  useEffect(() => {
    if (!workspace) return;

    async function loadSoul() {
      try {
        const existingSoul = await getSoul(workspace!.id);
        if (existingSoul) {
          setSoul(existingSoul);
          setHasStarted(true);
          setViewMode("view"); // Default to view mode when soul exists
        }
      } catch {
        // Silent fail - soul just won't be loaded
      } finally {
        setIsLoading(false);
      }
    }

    loadSoul();
  }, [workspace]);

  const handleInitialSubmit = useCallback((prompt: string) => {
    const newSoul = createDefaultSoul();
    setSoul(newSoul);
    setInitialPrompt(prompt);
    setHasStarted(true);
    setViewMode("edit"); // Go to edit mode when creating new soul
  }, []);

  const handleSoulChange = useCallback((updatedSoul: WorkspaceSoul) => {
    setSoul(updatedSoul);
  }, []);

  const handleSave = async () => {
    if (!workspace || !soul) return;

    setIsSaving(true);
    try {
      const savedSoul = await updateSoul(workspace.id, soul);
      setSoul(savedSoul);
    } catch {
      // Silent fail - could add error toast here
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditWithAI = useCallback(() => {
    setViewMode("edit");
  }, []);

  const handleViewSoul = useCallback(() => {
    setViewMode("view");
  }, []);

  if (!workspace || isLoading) {
    return (
      <GradientPage color={brand?.primaryColor ?? undefined}>
        <PageHeader
          label="Settings"
          title="Persona"
          subtitle="Configure the AI assistant's personality and behavior"
        />
        <section className="container">
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          </div>
        </section>
      </GradientPage>
    );
  }

  if (!isAdmin) {
    return (
      <GradientPage color={brand?.primaryColor ?? undefined}>
        <PageHeader
          label="Settings"
          title="Persona"
          subtitle="Configure the AI assistant's personality and behavior"
        />
        <section className="container">
          <p className="text-muted-foreground">
            You need admin access to configure the workspace AI persona.
          </p>
        </section>
      </GradientPage>
    );
  }

  // Show empty state if no soul and not started
  if (!hasStarted) {
    return <SoulEmptyState onSubmit={handleInitialSubmit} />;
  }

  if (!soul) {
    return null;
  }

  // View mode: show form centered
  if (viewMode === "view") {
    return (
      <GradientPage color={brand?.primaryColor ?? undefined}>
        <PageHeader
          label="Settings"
          title="Persona"
          subtitle="Configure the AI assistant's personality and behavior"
        />
        <section className="container">
          <SoulPreview
            soul={soul}
            onSoulChange={handleSoulChange}
            onSave={handleSave}
            isSaving={isSaving}
            mode="view"
            onEditWithAI={handleEditWithAI}
          />
        </section>
      </GradientPage>
    );
  }

  // Edit mode: show chat + preview side by side
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left: Chat */}
      <div className="flex-1 border-r border-border overflow-hidden">
        <SoulChat
          workspaceId={workspace.id}
          currentSoul={soul}
          initialPrompt={initialPrompt}
          onSoulChange={handleSoulChange}
        />
      </div>

      {/* Right: Preview */}
      <div className="w-96 overflow-hidden">
        <SoulPreview
          soul={soul}
          onSoulChange={handleSoulChange}
          onSave={handleSave}
          isSaving={isSaving}
          mode="edit"
          onViewSoul={handleViewSoul}
        />
      </div>
    </div>
  );
}
