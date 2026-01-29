"use client";

import { useState, useEffect, useCallback } from "react";
import { useSettingsContext } from "../context";
import { SoulEmptyState } from "./_components/SoulEmptyState";
import { SoulChat } from "./_components/SoulChat";
import { SoulPreview } from "./_components/SoulPreview";
import { getSoul, updateSoul } from "@/lib/actions/soul";
import { createDefaultSoul } from "@/lib/soul-formatters";
import type { WorkspaceSoul } from "@/lib/types";

type ViewMode = "view" | "edit";

export default function SoulSettingsPage() {
  const { workspace, isAdmin } = useSettingsContext();
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
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-8">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Persona</h1>
          <p className="text-muted-foreground">
            You need admin access to configure the workspace AI persona.
          </p>
        </div>
      </div>
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
      <div className="h-screen overflow-auto flex justify-center p-8">
        <div className="w-full max-w-2xl">
          <SoulPreview
            soul={soul}
            onSoulChange={handleSoulChange}
            onSave={handleSave}
            isSaving={isSaving}
            mode="view"
            onEditWithAI={handleEditWithAI}
          />
        </div>
      </div>
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
