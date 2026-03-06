"use client";

import { useState, useCallback } from "react";
import { KeyRound, Plus, Trash2, Copy, Check, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { createApiKey, deleteApiKey } from "@/lib/actions/api-keys";

function formatDate(date: Date | null): string {
  if (!date) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function ApiKeysPage() {
  const { workspace, apiKeys, isAdmin, brand, refreshApiKeys } =
    useSettingsContext();

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyExpiry, setKeyExpiry] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Reveal key dialog state
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!workspace || !keyName.trim()) return;

    setIsCreating(true);
    try {
      const expiresAt = keyExpiry ? new Date(keyExpiry) : undefined;
      const result = await createApiKey(workspace.id, keyName.trim(), expiresAt);
      setRevealedKey(result.key);
      setShowCreate(false);
      setKeyName("");
      setKeyExpiry("");
      await refreshApiKeys();
    } catch (err) {
      console.error("Failed to create API key:", err);
    } finally {
      setIsCreating(false);
    }
  }, [workspace, keyName, keyExpiry, refreshApiKeys]);

  const handleCopy = useCallback(async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable in some contexts
    }
  }, [revealedKey]);

  const handleDelete = useCallback(
    async (keyId: string) => {
      if (!workspace) return;
      if (!window.confirm("Are you sure you want to revoke this API key? This cannot be undone.")) return;

      setDeletingId(keyId);
      try {
        await deleteApiKey(workspace.id, keyId);
        await refreshApiKeys();
      } catch (err) {
        console.error("Failed to delete API key:", err);
      } finally {
        setDeletingId(null);
      }
    },
    [workspace, refreshApiKeys]
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
            title="Create API Key"
          >
            <Plus className="w-4 h-4" />
          </Button>
        ) : undefined
      }
    >
      <PageHeader
        label="Settings"
        title="API Keys"
        subtitle="Manage API keys for external integrations and webhooks"
      />

      <section className="container space-y-6">
        {apiKeys.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <KeyRound className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-medium text-foreground mb-1">
              No API keys yet
            </h3>
            <p className="text-sm text-muted-foreground">
              Create an API key to authenticate external requests to this workspace.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {key.name}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <code className="font-mono">{key.keyPrefix}...</code>
                      <span>Created {formatDate(key.createdAt)}</span>
                      {key.lastUsedAt ? (
                        <span>Last used {formatDate(key.lastUsedAt)}</span>
                      ) : (
                        <span>Never used</span>
                      )}
                      {key.expiresAt && (
                        <span
                          className={
                            key.expiresAt < new Date()
                              ? "text-destructive"
                              : ""
                          }
                        >
                          {key.expiresAt < new Date()
                            ? "Expired"
                            : `Expires ${formatDate(key.expiresAt)}`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(key.id)}
                    disabled={deletingId === key.id}
                    className="text-destructive hover:text-destructive"
                  >
                    {deletingId === key.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create API Key Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              API keys are used to authenticate external requests to your workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground">
                Name
              </label>
              <Input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. CI Pipeline, Monitoring"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">
                Expiration (optional)
              </label>
              <Input
                type="date"
                value={keyExpiry}
                onChange={(e) => setKeyExpiry(e.target.value)}
                className="mt-1"
                min={new Date().toISOString().split("T")[0]}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Leave empty for a key that never expires.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!keyName.trim() || isCreating}
            >
              {isCreating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Create Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reveal Key Dialog (shown after creation) */}
      <Dialog
        open={!!revealedKey}
        onOpenChange={(open) => {
          if (!open) {
            setRevealedKey(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription className="flex items-start gap-2 pt-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span>
                Copy your API key now. You won&apos;t be able to see it again.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2">
            <code className="flex-1 min-w-0 p-3 rounded-md bg-muted font-mono text-sm break-all select-all">
              {revealedKey}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 mt-1.5"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setRevealedKey(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GradientPage>
  );
}
