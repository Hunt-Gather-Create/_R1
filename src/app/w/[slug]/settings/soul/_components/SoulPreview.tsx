"use client";

import { Plus, Trash2, Pencil, Check, X, Sparkles, Eye, Download } from "lucide-react";
import { useState, useEffect } from "react";
import type { WorkspaceSoul } from "@/lib/types";
import { cn } from "@/lib/utils";
import { exportSoulAsMarkdown } from "@/lib/soul-formatters";

interface SoulPreviewProps {
  soul: WorkspaceSoul;
  onSoulChange: (soul: WorkspaceSoul) => void;
  onSave: () => void;
  isSaving: boolean;
  mode: "view" | "edit";
  onEditWithAI?: () => void;
  onViewSoul?: () => void;
}

function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const TONE_OPTIONS: Array<{ value: WorkspaceSoul["tone"]; label: string }> = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "casual", label: "Casual" },
  { value: "formal", label: "Formal" },
];

const RESPONSE_LENGTH_OPTIONS: Array<{
  value: WorkspaceSoul["responseLength"];
  label: string;
}> = [
  { value: "concise", label: "Concise" },
  { value: "moderate", label: "Moderate" },
  { value: "detailed", label: "Detailed" },
];

export function SoulPreview({
  soul,
  onSoulChange,
  onSave,
  isSaving,
  mode,
  onEditWithAI,
  onViewSoul,
}: SoulPreviewProps) {
  const handleExport = () => {
    const markdown = exportSoulAsMarkdown(soul);
    const filename = `${soul.name || "persona"}-system-prompt.md`.toLowerCase().replace(/\s+/g, "-");
    downloadMarkdown(markdown, filename);
  };

  return (
    <div className={cn("flex flex-col h-full", mode === "view" ? "bg-card rounded-lg border border-border" : "bg-card/30")}>
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {soul.name || "Untitled Persona"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "view" ? "Workspace AI persona" : "Persona configuration"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {mode === "view" && onEditWithAI && (
              <button
                onClick={onEditWithAI}
                className="flex items-center justify-center p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title="Edit with AI"
              >
                <Sparkles className="w-4 h-4" />
                <span className="sr-only">Edit with AI</span>
              </button>
            )}
            {mode === "edit" && onViewSoul && (
              <button
                onClick={onViewSoul}
                className="flex items-center justify-center p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title="View Persona"
              >
                <Eye className="w-4 h-4" />
                <span className="sr-only">View Persona</span>
              </button>
            )}
            <button
              onClick={handleExport}
              className="flex items-center justify-center p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="Export as Markdown"
            >
              <Download className="w-4 h-4" />
              <span className="sr-only">Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Name */}
        <EditableField
          label="Name"
          value={soul.name}
          onChange={(name) => onSoulChange({ ...soul, name })}
          placeholder="Give your AI a name..."
        />

        {/* Personality */}
        <EditableField
          label="Personality"
          value={soul.personality}
          onChange={(personality) => onSoulChange({ ...soul, personality })}
          placeholder="Describe the personality..."
          multiline
        />

        {/* Tone */}
        <SelectField
          label="Tone"
          value={soul.tone}
          options={TONE_OPTIONS}
          onChange={(tone) =>
            onSoulChange({ ...soul, tone: tone as WorkspaceSoul["tone"] })
          }
        />

        {/* Response Length */}
        <SelectField
          label="Response Length"
          value={soul.responseLength}
          options={RESPONSE_LENGTH_OPTIONS}
          onChange={(responseLength) =>
            onSoulChange({
              ...soul,
              responseLength: responseLength as WorkspaceSoul["responseLength"],
            })
          }
        />

        {/* Primary Goals */}
        <ListField
          label="Primary Goals"
          items={soul.primaryGoals}
          onChange={(primaryGoals) => onSoulChange({ ...soul, primaryGoals })}
          placeholder="Add a goal..."
          emptyText="No goals defined yet."
        />

        {/* Domain Expertise */}
        <ListField
          label="Domain Expertise"
          items={soul.domainExpertise}
          onChange={(domainExpertise) =>
            onSoulChange({ ...soul, domainExpertise })
          }
          placeholder="Add an area of expertise..."
          emptyText="No expertise areas defined yet."
        />

        {/* Do Rules */}
        <ListField
          label="Do's"
          items={soul.doRules}
          onChange={(doRules) => onSoulChange({ ...soul, doRules })}
          placeholder="Add something the AI should do..."
          emptyText="No do rules defined yet."
        />

        {/* Don't Rules */}
        <ListField
          label="Don'ts"
          items={soul.dontRules}
          onChange={(dontRules) => onSoulChange({ ...soul, dontRules })}
          placeholder="Add something the AI should NOT do..."
          emptyText="No don't rules defined yet."
        />

        {/* Terminology */}
        <TerminologyField
          terminology={soul.terminology}
          onChange={(terminology) => onSoulChange({ ...soul, terminology })}
        />

        {/* Greeting */}
        <EditableField
          label="Custom Greeting"
          value={soul.greeting || ""}
          onChange={(greeting) =>
            onSoulChange({ ...soul, greeting: greeting || undefined })
          }
          placeholder="Optional greeting message..."
          multiline
        />
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <button
          onClick={onSave}
          disabled={!soul.name || isSaving}
          className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? "Saving..." : "Save Persona"}
        </button>
        {!soul.name && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            A name is required to save
          </p>
        )}
      </div>
    </div>
  );
}

// Unified editable field component (supports single-line and multiline)
function EditableField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  // Sync editValue when value prop changes (fixes stale value bug)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value);
    }
  }, [value, isEditing]);

  const handleSave = () => {
    onChange(editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        )}
      </div>

      {isEditing ? (
        multiline ? (
          <div className="space-y-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full px-2 py-1 bg-background border border-input rounded text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[80px] resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancel}
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 px-2 py-1 bg-background border border-input rounded text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <button
              onClick={handleSave}
              className="p-1 rounded text-green-500 hover:bg-muted"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={handleCancel}
              className="p-1 rounded text-muted-foreground hover:bg-muted"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      ) : (
        <p className={cn("text-sm", value ? "text-foreground" : "text-muted-foreground italic")}>
          {value || placeholder}
        </p>
      )}
    </div>
  );
}

// Select field
function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-foreground mb-2">{label}</h3>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 bg-background border border-input rounded text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// List field (for arrays)
function ListField({
  label,
  items,
  onChange,
  placeholder,
  emptyText,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const [newItem, setNewItem] = useState("");

  const handleAdd = () => {
    if (newItem.trim()) {
      onChange([...items, newItem.trim()]);
      setNewItem("");
    }
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">
          {label} ({items.length})
        </h3>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-2">{emptyText}</p>
      ) : (
        <ul className="space-y-1 mb-2">
          {items.map((item, index) => (
            <li
              key={index}
              className="flex items-center gap-2 p-1.5 rounded bg-muted/50 text-sm group"
            >
              <span className="flex-1">{item}</span>
              <button
                onClick={() => handleRemove(index)}
                className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-2 py-1 bg-background border border-input rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button
          onClick={handleAdd}
          disabled={!newItem.trim()}
          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Terminology field (key-value pairs)
function TerminologyField({
  terminology,
  onChange,
}: {
  terminology: Record<string, string>;
  onChange: (terminology: Record<string, string>) => void;
}) {
  const [newTerm, setNewTerm] = useState("");
  const [newDef, setNewDef] = useState("");

  const entries = Object.entries(terminology);

  const handleAdd = () => {
    if (newTerm.trim() && newDef.trim()) {
      onChange({ ...terminology, [newTerm.trim()]: newDef.trim() });
      setNewTerm("");
      setNewDef("");
    }
  };

  const handleRemove = (term: string) => {
    const newTerminology = { ...terminology };
    delete newTerminology[term];
    onChange(newTerminology);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">
          Terminology ({entries.length})
        </h3>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-2">
          No terminology defined yet.
        </p>
      ) : (
        <ul className="space-y-1 mb-2">
          {entries.map(([term, definition]) => (
            <li
              key={term}
              className="flex items-start gap-2 p-1.5 rounded bg-muted/50 text-sm group"
            >
              <div className="flex-1">
                <span className="font-medium">{term}:</span>{" "}
                <span className="text-muted-foreground">{definition}</span>
              </div>
              <button
                onClick={() => handleRemove(term)}
                className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <input
          type="text"
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          placeholder="Term"
          className="w-full px-2 py-1 bg-background border border-input rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          type="text"
          value={newDef}
          onChange={(e) => setNewDef(e.target.value)}
          placeholder="Definition"
          className="w-full px-2 py-1 bg-background border border-input rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button
          onClick={handleAdd}
          disabled={!newTerm.trim() || !newDef.trim()}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <Plus className="w-3 h-3" />
          Add term
        </button>
      </div>
    </div>
  );
}
