"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { LABEL_COLORS } from "@/lib/design-tokens";
import type { Label } from "@/lib/types";

interface LabelSelectProps {
  selectedLabels: Label[];
  availableLabels: Label[];
  onAdd: (labelId: string) => void;
  onRemove: (labelId: string) => void;
  onCreateLabel?: (name: string, color: string) => Promise<Label | undefined>;
  className?: string;
}

function LabelPill({
  label,
  onRemove,
}: {
  label: Label;
  onRemove?: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full"
      style={{
        backgroundColor: `${label.color}20`,
        color: label.color,
      }}
    >
      {label.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:bg-black/10 rounded-full p-0.5"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

function InlineColorPicker({
  selectedColor,
  onSelect,
}: {
  selectedColor: string;
  onSelect: (color: string) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {LABEL_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          onClick={() => onSelect(color.value)}
          className={cn(
            "w-5 h-5 rounded-full transition-all",
            selectedColor === color.value
              ? "ring-2 ring-offset-1 ring-offset-popover ring-primary"
              : "hover:scale-110"
          )}
          style={{ backgroundColor: color.value }}
          title={color.name}
        />
      ))}
    </div>
  );
}

function CreateLabelForm({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LABEL_COLORS[0].value);
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isCreating) return;
    setIsCreating(true);
    try {
      await onCreate(name.trim(), color);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Label name"
        autoFocus
        className="w-full px-2 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <InlineColorPicker selectedColor={color} onSelect={setColor} />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!name.trim() || isCreating}
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-xs font-medium rounded",
            "bg-primary text-primary-foreground",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <Check className="w-3 h-3" />
          {isCreating ? "Creating..." : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function LabelSelect({
  selectedLabels,
  availableLabels,
  onAdd,
  onRemove,
  onCreateLabel,
  className,
}: LabelSelectProps) {
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const selectedIds = new Set(selectedLabels.map((l) => l.id));
  const unselectedLabels = availableLabels.filter(
    (l) => !selectedIds.has(l.id)
  );

  const handleCreateLabel = async (name: string, color: string) => {
    if (!onCreateLabel) return;
    const newLabel = await onCreateLabel(name, color);
    if (newLabel) {
      onAdd(newLabel.id);
    }
    setIsCreating(false);
    setOpen(false);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Selected labels */}
      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedLabels.map((label) => (
            <LabelPill
              key={label.id}
              label={label}
              onRemove={() => onRemove(label.id)}
            />
          ))}
        </div>
      )}

      {/* Add label button */}
      <Popover
        open={open}
        onOpenChange={(newOpen) => {
          setOpen(newOpen);
          if (!newOpen) setIsCreating(false);
        }}
      >
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground",
              "hover:text-foreground hover:bg-accent rounded transition-colors"
            )}
          >
            <Plus className="w-3 h-3" />
            Add label
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          {isCreating ? (
            <CreateLabelForm
              onCreate={handleCreateLabel}
              onCancel={() => setIsCreating(false)}
            />
          ) : (
            <div className="space-y-1">
              {unselectedLabels.length === 0 && !onCreateLabel ? (
                <p className="text-xs text-muted-foreground p-2 text-center">
                  No more labels available
                </p>
              ) : (
                <>
                  {unselectedLabels.map((label) => (
                    <button
                      key={label.id}
                      onClick={() => {
                        onAdd(label.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded",
                        "hover:bg-accent transition-colors text-left"
                      )}
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="text-sm">{label.name}</span>
                    </button>
                  ))}
                  {onCreateLabel && (
                    <>
                      {unselectedLabels.length > 0 && (
                        <div className="border-t border-border my-1" />
                      )}
                      <button
                        onClick={() => setIsCreating(true)}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded",
                          "text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left"
                        )}
                      >
                        <Plus className="w-3 h-3" />
                        <span className="text-sm">Create new label</span>
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
