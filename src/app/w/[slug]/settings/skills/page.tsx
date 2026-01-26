"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Power, Info } from "lucide-react";
import {
  createWorkspaceSkill,
  updateWorkspaceSkill,
  deleteWorkspaceSkill,
  toggleWorkspaceSkill,
} from "@/lib/actions/skills";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSettingsContext } from "../context";
import type { WorkspaceSkill } from "@/lib/types";
import { cn } from "@/lib/utils";

function SkillRow({
  skill,
  isAdmin,
  onEdit,
  onDelete,
  onToggle,
}: {
  skill: WorkspaceSkill;
  isAdmin: boolean;
  onEdit: (
    skill: WorkspaceSkill,
    name: string,
    description: string,
    content: string
  ) => Promise<void>;
  onDelete: (skill: WorkspaceSkill) => Promise<void>;
  onToggle: (skill: WorkspaceSkill) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(skill.name);
  const [editDescription, setEditDescription] = useState(skill.description);
  const [editContent, setEditContent] = useState(skill.content);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!editName.trim() || !editDescription.trim() || !editContent.trim())
      return;
    setIsSaving(true);
    try {
      await onEdit(
        skill,
        editName.trim(),
        editDescription.trim(),
        editContent.trim()
      );
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(skill.name);
    setEditDescription(skill.description);
    setEditContent(skill.content);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="px-6 py-4 border-b border-border last:border-b-0 space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Name
          </label>
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Skill name (e.g., code-review)"
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            When to use (triggers)
          </label>
          <Input
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Describe when the AI should use this skill"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Instructions (markdown)
          </label>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder="Write the instructions for the AI to follow..."
            className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={
              isSaving ||
              !editName.trim() ||
              !editDescription.trim() ||
              !editContent.trim()
            }
          >
            <Check className="w-4 h-4 mr-1" />
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between px-6 py-4 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-medium",
              skill.isEnabled ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {skill.name}
          </span>
          {!skill.isEnabled && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Disabled
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {skill.description}
        </p>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-1 ml-4">
          <button
            onClick={() => onToggle(skill)}
            className={cn(
              "p-1.5 rounded transition-colors",
              skill.isEnabled
                ? "text-green-500 hover:text-green-600"
                : "text-muted-foreground hover:text-foreground"
            )}
            title={skill.isEnabled ? "Disable skill" : "Enable skill"}
          >
            <Power className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
            title="Edit skill"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(skill)}
            className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
            title="Delete skill"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function AddSkillForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !description.trim() || !content.trim()) return;
    setIsCreating(true);
    try {
      await createWorkspaceSkill(workspaceId, {
        name: name.trim(),
        description: description.trim(),
        content: content.trim(),
      });
      setName("");
      setDescription("");
      setContent("");
      setIsOpen(false);
      onCreated();
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    setName("");
    setDescription("");
    setContent("");
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <Button onClick={() => setIsOpen(true)} className="gap-2">
        <Plus className="w-4 h-4" />
        Add Skill
      </Button>
    );
  }

  return (
    <div className="p-6 bg-card rounded-lg border border-border">
      <h3 className="text-sm font-medium text-foreground mb-4">
        Create new skill
      </h3>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill name (e.g., bug-triage, content-review)"
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            When to use (triggers)
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe when the AI should activate this skill"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Example: "When the user mentions bug priority or triage"
          </p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Instructions (markdown)
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write detailed instructions for the AI to follow when this skill is triggered..."
            className="flex min-h-[150px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Button
            onClick={handleCreate}
            disabled={
              isCreating ||
              !name.trim() ||
              !description.trim() ||
              !content.trim()
            }
          >
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

export default function SkillsSettingsPage() {
  const { workspace, skills, isAdmin, refreshSkills } = useSettingsContext();

  const handleEdit = async (
    skill: WorkspaceSkill,
    name: string,
    description: string,
    content: string
  ) => {
    await updateWorkspaceSkill(skill.id, { name, description, content });
    await refreshSkills();
  };

  const handleDelete = async (skill: WorkspaceSkill) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete the skill "${skill.name}"?`
    );
    if (!confirmed) return;

    try {
      await deleteWorkspaceSkill(skill.id);
      await refreshSkills();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete skill");
    }
  };

  const handleToggle = async (skill: WorkspaceSkill) => {
    try {
      await toggleWorkspaceSkill(skill.id);
      await refreshSkills();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to toggle skill");
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">AI Skills</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create custom skills to extend AI assistant capabilities
        </p>
      </div>

      {/* Help Section */}
      <div className="mb-6 p-4 bg-muted/50 rounded-lg border border-border">
        <div className="flex gap-2">
          <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">
              How skills work
            </p>
            <p>
              Skills are custom instructions that guide the AI when specific
              triggers are mentioned. When a user's message matches a skill's
              trigger description, the AI will follow that skill's instructions.
            </p>
            <p className="mt-2">
              <strong>Example:</strong> Create a "bug-triage" skill with trigger
              "When discussing bug severity or priority" and instructions on how
              to categorize bugs based on your team's criteria.
            </p>
          </div>
        </div>
      </div>

      {/* Add Skill Button/Form */}
      {isAdmin && workspace && (
        <div className="mb-6">
          <AddSkillForm workspaceId={workspace.id} onCreated={refreshSkills} />
        </div>
      )}

      {/* Skills List */}
      <div className="rounded-lg border border-border bg-card">
        {skills.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No custom skills yet. {isAdmin ? "Create one to get started." : ""}
            </p>
          </div>
        ) : (
          skills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              isAdmin={isAdmin}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>
    </div>
  );
}
