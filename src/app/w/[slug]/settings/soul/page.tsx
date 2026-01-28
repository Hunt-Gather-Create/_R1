"use client";

import { useState, useEffect, useCallback } from "react";
import { useSettingsContext } from "../context";
import { SoulEmptyState } from "./_components/SoulEmptyState";
import { SoulChat } from "./_components/SoulChat";
import { SoulPreview } from "./_components/SoulPreview";
import { getSoul, updateSoul } from "@/lib/actions/soul";
import type { WorkspaceSoul } from "@/lib/types";

function createDefaultSoul(): WorkspaceSoul {
  const now = new Date().toISOString();
  return {
    name: "",
    personality: "",
    primaryGoals: [],
    tone: "friendly",
    responseLength: "moderate",
    domainExpertise: [],
    terminology: {},
    doRules: [],
    dontRules: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export default function SoulSettingsPage() {
  const { workspace, isAdmin } = useSettingsContext();
  const [soul, setSoul] = useState<WorkspaceSoul | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);
  const [hasStarted, setHasStarted] = useState(false);

  // Load existing soul
  useEffect(() => {
    if (!workspace) return;

    async function loadSoul() {
      try {
        const existingSoul = await getSoul(workspace!.id);
        if (existingSoul) {
          setSoul(existingSoul);
          setHasStarted(true);
        }
      } catch (error) {
        console.error("Failed to load soul:", error);
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
    } catch (error) {
      console.error("Failed to save soul:", error);
    } finally {
      setIsSaving(false);
    }
  };

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
          <h1 className="text-2xl font-semibold text-foreground mb-2">Soul</h1>
          <p className="text-muted-foreground">
            You need admin access to configure the workspace soul.
          </p>
        </div>
      </div>
    );
  }

  // Show empty state if no soul and not started
  if (!hasStarted) {
    return <SoulEmptyState onSubmit={handleInitialSubmit} />;
  }

  // Show chat + preview
  if (!soul) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left: Chat */}
      <div className="flex-1 border-r border-border overflow-hidden">
        <SoulChat
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
        />
      </div>
    </div>
  );
}
