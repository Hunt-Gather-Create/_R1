"use client";

import { useState, useCallback } from "react";
import {
  Webhook,
  Plus,
  Trash2,
  Copy,
  Check,
  Loader2,
  Pencil,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useSettingsContext } from "../context";
import {
  createWebhook,
  updateWebhook,
  deleteWebhook,
} from "@/lib/actions/webhooks";
import type { Webhook as WebhookType } from "@/lib/types";

function getWebhookUrl(workspaceSlug: string, webhookSlug: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${origin}/api/webhooks/${workspaceSlug}/${webhookSlug}`;
}

export default function WebhooksPage() {
  const { workspace, webhooks, isAdmin, brand, refreshWebhooks } =
    useSettingsContext();

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit dialog state
  const [editingWebhook, setEditingWebhook] = useState<WebhookType | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Copy state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!workspace || !newName.trim() || !newPrompt.trim()) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      await createWebhook(workspace.id, {
        name: newName.trim(),
        prompt: newPrompt.trim(),
        slug: newSlug.trim() || undefined,
      });
      setShowCreate(false);
      setNewName("");
      setNewSlug("");
      setNewPrompt("");
      await refreshWebhooks();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create webhook"
      );
    } finally {
      setIsCreating(false);
    }
  }, [workspace, newName, newSlug, newPrompt, refreshWebhooks]);

  const handleCopyUrl = useCallback(
    async (webhookSlug: string, webhookId: string) => {
      if (!workspace) return;
      try {
        const url = getWebhookUrl(workspace.slug, webhookSlug);
        await navigator.clipboard.writeText(url);
        setCopiedId(webhookId);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        // Clipboard API may be unavailable in some contexts
      }
    },
    [workspace]
  );

  const handleToggleActive = useCallback(
    async (webhook: WebhookType) => {
      if (!workspace) return;
      await updateWebhook(workspace.id, webhook.id, {
        isActive: !webhook.isActive,
      });
      await refreshWebhooks();
    },
    [workspace, refreshWebhooks]
  );

  const handleEdit = useCallback((webhook: WebhookType) => {
    setEditingWebhook(webhook);
    setEditName(webhook.name);
    setEditPrompt(webhook.prompt);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!workspace || !editingWebhook || !editName.trim() || !editPrompt.trim())
      return;

    setIsSaving(true);
    try {
      await updateWebhook(workspace.id, editingWebhook.id, {
        name: editName.trim(),
        prompt: editPrompt.trim(),
      });
      setEditingWebhook(null);
      await refreshWebhooks();
    } catch (err) {
      console.error("Failed to update webhook:", err);
    } finally {
      setIsSaving(false);
    }
  }, [workspace, editingWebhook, editName, editPrompt, refreshWebhooks]);

  const handleDelete = useCallback(
    async (webhookId: string) => {
      if (!workspace) return;
      if (!window.confirm("Are you sure you want to delete this webhook?"))
        return;

      setDeletingId(webhookId);
      try {
        await deleteWebhook(workspace.id, webhookId);
        await refreshWebhooks();
      } catch (err) {
        console.error("Failed to delete webhook:", err);
      } finally {
        setDeletingId(null);
      }
    },
    [workspace, refreshWebhooks]
  );

  return (
    <GradientPage
      color={brand?.primaryColor ?? undefined}
      actions={
        isAdmin ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowCreate(true)}
            className="bg-background/50 hover:bg-background/80"
            title="Create Webhook"
          >
            <Plus className="w-4 h-4" />
          </Button>
        ) : undefined
      }
    >
      <PageHeader
        label="Settings"
        title="Webhooks"
        subtitle="Create POST endpoints that accept data and use AI to create issues"
      />

      <section className="container space-y-6">
        {webhooks.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <Webhook className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-medium text-foreground mb-1">
              No webhooks yet
            </h3>
            <p className="text-sm text-muted-foreground">
              Create a webhook to accept data from external systems and
              auto-create issues with AI.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {webhooks.map((wh) => (
              <div key={wh.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Webhook className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">
                          {wh.name}
                        </p>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full ${
                            wh.isActive
                              ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {wh.isActive ? "Active" : "Disabled"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(wh)}
                        title={wh.isActive ? "Disable" : "Enable"}
                      >
                        {wh.isActive ? (
                          <ToggleRight className="w-4 h-4 text-green-600" />
                        ) : (
                          <ToggleLeft className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(wh)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(wh.id)}
                        disabled={deletingId === wh.id}
                        className="text-destructive hover:text-destructive"
                      >
                        {deletingId === wh.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Webhook URL */}
                {workspace && (
                  <div className="flex items-center gap-2 ml-7">
                    <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded truncate">
                      POST {getWebhookUrl(workspace.slug, wh.slug)}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-6 w-6 p-0"
                      onClick={() => handleCopyUrl(wh.slug, wh.id)}
                    >
                      {copiedId === wh.id ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create Webhook Dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open);
          if (!open) setCreateError(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Webhook</DialogTitle>
            <DialogDescription>
              Webhooks accept POST requests and use AI to transform the data
              into issues.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground">
                Name
              </label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. GitHub Issues Sync"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">
                URL Slug (optional)
              </label>
              <Input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="Auto-generated from name"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                URL-safe identifier. Leave empty to auto-generate from name.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">
                AI Prompt
              </label>
              <Textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="Extract the issue title, description, priority, and status from the incoming data. The data comes from..."
                className="mt-1 min-h-[120px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Instructions for the AI on how to process incoming data into
                issues.
              </p>
            </div>

            {createError && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                {createError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || !newPrompt.trim() || isCreating}
            >
              {isCreating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Create Webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Webhook Dialog */}
      <Dialog
        open={!!editingWebhook}
        onOpenChange={(open) => {
          if (!open) setEditingWebhook(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Webhook</DialogTitle>
            <DialogDescription>
              Update the webhook name and AI prompt.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground">
                Name
              </label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">
                AI Prompt
              </label>
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                className="mt-1 min-h-[120px]"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditingWebhook(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={
                !editName.trim() || !editPrompt.trim() || isSaving
              }
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GradientPage>
  );
}
