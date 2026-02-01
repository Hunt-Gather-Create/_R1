"use client";

import { Plus, Trash2, Sparkles, Eye, Download } from "lucide-react";
import { useState } from "react";
import type { WorkspaceSoul } from "@/lib/types";
import { cn } from "@/lib/utils";
import { exportSoulAsMarkdown } from "@/lib/soul-formatters";
import { EditableField, ListField } from "@/components/ui/editable-field";

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
