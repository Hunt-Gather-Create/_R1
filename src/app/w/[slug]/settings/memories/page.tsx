"use client";

import { useState } from "react";
import { Trash2, Tag, Calendar, Brain } from "lucide-react";
import { deleteWorkspaceMemory } from "@/lib/actions/memories";
import { Button } from "@/components/ui/button";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import { useSettingsContext } from "../context";
import { parseMemoryTags } from "@/lib/utils";
import type { WorkspaceMemory } from "@/lib/types";

function formatDate(date: Date | null): string {
  if (!date) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function MemoryRow({
  memory,
  isAdmin,
  onDelete,
}: {
  memory: WorkspaceMemory;
  isAdmin: boolean;
  onDelete: (memory: WorkspaceMemory) => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const tags = parseMemoryTags(memory.tags);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(memory);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="settings-list-item px-6 py-4 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
            {memory.content}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {tags.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 text-xs rounded bg-accent text-accent-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />
              <span>{formatDate(memory.updatedAt)}</span>
            </div>
          </div>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-muted-foreground hover:text-destructive"
            title="Delete memory"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function MemoriesSettingsPage() {
  const { memories, isAdmin, refreshMemories, brand } = useSettingsContext();

  const handleDelete = async (memory: WorkspaceMemory) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this memory? This action cannot be undone."
    );
    if (!confirmed) return;

    try {
      await deleteWorkspaceMemory(memory.id);
      await refreshMemories();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete memory");
    }
  };

  return (
    <GradientPage color={brand?.primaryColor ?? undefined}>
      <PageHeader
        label="Settings"
        title="Memories"
        subtitle="AI-created memories that persist across chat sessions"
      />

      <section className="container">
        {/* Info Section */}
        <div className="mb-6 p-4 bg-muted/50 rounded-lg border border-border">
          <div className="flex items-start gap-3">
            <Brain className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm text-foreground">
                Memories are created automatically by the AI during conversations.
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                When you share important information, preferences, or context, the AI may
                store it as a memory to provide more personalized assistance in future
                conversations.
              </p>
            </div>
          </div>
        </div>

        {/* Memories List */}
        <div className="rounded-lg border border-border bg-card">
          {memories.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <Brain className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No memories yet. Start a conversation and share some context or preferences.
              </p>
            </div>
          ) : (
            memories.map((memory) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                isAdmin={isAdmin}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </section>
    </GradientPage>
  );
}
