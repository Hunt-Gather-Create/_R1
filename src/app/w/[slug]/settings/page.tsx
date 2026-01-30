"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import {
  getWorkspaceBySlug,
  updateWorkspaceSettings,
  deleteWorkspace,
} from "@/lib/actions/workspace";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSettingsContext } from "./context";
import {
  PURPOSE_CONFIG,
  type WorkspacePurpose,
  type TemplateWorkspacePurpose,
} from "@/lib/design-tokens";

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-8 px-6 py-4 border-b border-border last:border-b-0">
      <div className="shrink-0 min-w-35">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="flex-1 max-w-md">{children}</div>
    </div>
  );
}

export default function WorkspaceSettingsPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const { workspace, isAdmin, isOwner, refreshWorkspace } =
    useSettingsContext();

  // Form state - initialized from workspace
  const [name, setName] = useState(workspace?.name ?? "");
  const [slug, setSlug] = useState(workspace?.slug ?? "");
  const [purpose, setPurpose] = useState<WorkspacePurpose>(
    (workspace?.purpose as WorkspacePurpose) ?? "software"
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Check for changes
  const hasChanges = useMemo(() => {
    if (!workspace) return false;
    return (
      name !== workspace.name ||
      slug !== workspace.slug ||
      purpose !== workspace.purpose
    );
  }, [workspace, name, slug, purpose]);

  // Get hostname for URL display
  const hostname =
    typeof window !== "undefined" ? window.location.host : "localhost:3000";

  const handleSave = async () => {
    if (!workspace || !hasChanges) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const result = await updateWorkspaceSettings(workspace.id, {
        name,
        slug,
        purpose,
      });

      if (result.success) {
        setSaveMessage({ type: "success", text: result.message });

        // If slug changed, redirect to new URL
        if (result.newSlug && result.newSlug !== params.slug) {
          router.replace(`/w/${result.newSlug}/settings`);
        } else {
          // Refresh workspace data in context
          await refreshWorkspace();
          const updatedWs = await getWorkspaceBySlug(params.slug);
          if (updatedWs) {
            setName(updatedWs.name);
            setSlug(updatedWs.slug);
            setPurpose((updatedWs.purpose as WorkspacePurpose) ?? "software");
          }
        }
      } else {
        setSaveMessage({ type: "error", text: result.message });
      }
    } catch (err) {
      setSaveMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save settings",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!workspace || !isOwner) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${workspace.name}"? This action cannot be undone and will permanently delete all data including issues, columns, and labels.`
    );

    if (!confirmed) return;

    setIsDeleting(true);

    try {
      await deleteWorkspace(workspace.id);
      router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete workspace");
      setIsDeleting(false);
    }
  };

  // Normalize slug as user types
  const handleSlugChange = (value: string) => {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/--+/g, "-")
      .replace(/^-/, "");
    setSlug(normalized);
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Workspace</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your workspace settings
        </p>
      </div>

      {/* Main Settings Card */}
      <div className="rounded-lg border border-border bg-card mb-8">
        <SettingsRow label="Icon">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded flex items-center justify-center">
              <Layers className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-sm text-muted-foreground">
              {workspace?.name?.slice(0, 2).toUpperCase() || "WS"}
            </span>
          </div>
        </SettingsRow>

        <SettingsRow label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
            placeholder="Workspace name"
          />
        </SettingsRow>

        <SettingsRow label="URL">
          <div className="flex items-center">
            <span className="text-sm text-muted-foreground mr-1">
              {hostname}/w/
            </span>
            <Input
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              disabled={!isAdmin}
              placeholder="workspace-slug"
              className="flex-1"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          label="Type"
          description="Affects AI suggestions and default workflows"
        >
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as WorkspacePurpose)}
            disabled={!isAdmin}
            className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {(Object.keys(PURPOSE_CONFIG) as TemplateWorkspacePurpose[]).map(
              (key) => (
                <option key={key} value={key}>
                  {PURPOSE_CONFIG[key].label}
                </option>
              )
            )}
            <option value="custom">Custom</option>
          </select>
        </SettingsRow>
      </div>

      {/* Save Button */}
      {isAdmin && (
        <div className="flex items-center justify-between mb-12">
          <div>
            {saveMessage && (
              <span
                className={`text-sm ${
                  saveMessage.type === "success"
                    ? "text-green-600"
                    : "text-destructive"
                }`}
              >
                {saveMessage.text}
              </span>
            )}
          </div>
          <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      )}

      {/* Danger Zone */}
      {isOwner && (
        <>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              Danger zone
            </h2>
            <p className="text-sm text-muted-foreground">
              Irreversible and destructive actions
            </p>
          </div>

          <div className="rounded-lg border border-destructive/50 bg-card">
            <div className="flex items-center justify-between gap-4 px-6 py-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Delete workspace
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Permanently delete this workspace and all of its data
                </div>
              </div>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete workspace"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
