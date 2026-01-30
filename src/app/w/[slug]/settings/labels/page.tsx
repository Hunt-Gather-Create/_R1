"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { createLabel, updateLabel, deleteLabel } from "@/lib/actions/board";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import { useSettingsContext } from "../context";
import { LABEL_COLORS } from "@/lib/design-tokens";
import type { Label } from "@/lib/types";

function ColorPicker({
  selectedColor,
  onSelect,
}: {
  selectedColor: string;
  onSelect: (color: string) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {LABEL_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          onClick={() => onSelect(color.value)}
          className={`w-6 h-6 rounded-full transition-all ${
            selectedColor === color.value
              ? "ring-2 ring-offset-2 ring-offset-background ring-primary scale-110"
              : "hover:scale-110"
          }`}
          style={{ backgroundColor: color.value }}
          title={color.name}
        />
      ))}
    </div>
  );
}

function LabelRow({
  label,
  isAdmin,
  onEdit,
  onDelete,
}: {
  label: Label;
  isAdmin: boolean;
  onEdit: (label: Label, name: string, color: string) => Promise<void>;
  onDelete: (label: Label) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(label.name);
  const [editColor, setEditColor] = useState(label.color);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!editName.trim()) return;
    setIsSaving(true);
    try {
      await onEdit(label, editName.trim(), editColor);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(label.name);
    setEditColor(label.color);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border last:border-b-0">
        <div
          className="w-4 h-4 rounded-full flex-shrink-0"
          style={{ backgroundColor: editColor }}
        />
        <div className="flex-1 space-y-3">
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Label name"
            className="max-w-xs"
            autoFocus
          />
          <ColorPicker selectedColor={editColor} onSelect={setEditColor} />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !editName.trim()}
          >
            <Check className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-list-item flex items-center justify-between px-6 py-4 border-b border-border last:border-b-0">
      <div className="flex items-center gap-3">
        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: label.color }}
        />
        <span className="text-sm font-medium text-foreground">
          {label.name}
        </span>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
            title="Edit label"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(label)}
            className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
            title="Delete label"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function AddLabelForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LABEL_COLORS[0].value);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      await createLabel(workspaceId, name.trim(), color);
      setName("");
      setColor(LABEL_COLORS[0].value);
      setIsOpen(false);
      onCreated();
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    setName("");
    setColor(LABEL_COLORS[0].value);
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <Button onClick={() => setIsOpen(true)} className="gap-2">
        <Plus className="w-4 h-4" />
        Add Label
      </Button>
    );
  }

  return (
    <div className="p-6 bg-card rounded-lg border border-border">
      <h3 className="text-sm font-medium text-foreground mb-4">
        Create new label
      </h3>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Label name"
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Color
          </label>
          <ColorPicker selectedColor={color} onSelect={setColor} />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={handleCreate} disabled={isCreating || !name.trim()}>
            {isCreating ? "Creating..." : "Create"}
          </Button>
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function LabelsSettingsPage() {
  const { workspace, labels, isAdmin, refreshLabels, brand } = useSettingsContext();

  const handleEdit = async (label: Label, name: string, color: string) => {
    await updateLabel(label.id, { name, color });
    await refreshLabels();
  };

  const handleDelete = async (label: Label) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete the label "${label.name}"? This will remove it from all issues.`
    );
    if (!confirmed) return;

    try {
      await deleteLabel(label.id);
      await refreshLabels();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete label");
    }
  };

  return (
    <GradientPage color={brand?.primaryColor ?? undefined}>
      <PageHeader
        label="Settings"
        title="Labels"
        subtitle="Manage labels for categorizing issues in this workspace"
      />

      <section className="container">
        {/* Add Label Button/Form */}
        {isAdmin && workspace && (
          <div className="mb-6">
            <AddLabelForm workspaceId={workspace.id} onCreated={refreshLabels} />
          </div>
        )}

        {/* Labels List */}
        <div className="rounded-lg border border-border bg-card">
          {labels.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No labels yet. {isAdmin ? "Create one to get started." : ""}
              </p>
            </div>
          ) : (
            labels.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                isAdmin={isAdmin}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </section>
    </GradientPage>
  );
}
