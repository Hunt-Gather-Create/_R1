"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Column } from "@/lib/types";

interface SortableColumnRowProps {
  column: Column;
  isAdmin: boolean;
  onEdit: (column: Column, name: string) => Promise<void>;
  onDelete: (column: Column) => Promise<void>;
  issueCount?: number;
}

export function SortableColumnRow({
  column,
  isAdmin,
  onEdit,
  onDelete,
  issueCount,
}: SortableColumnRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(column.name);
  const [isSaving, setIsSaving] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    setIsSaving(true);
    try {
      await onEdit(column, editName.trim());
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(column.name);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-4 px-6 py-4 border-b border-border last:border-b-0 bg-card"
      >
        <div className="w-6" />
        <div className="flex-1">
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Column name"
            className="max-w-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
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
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between px-6 py-4 border-b border-border last:border-b-0 bg-card"
    >
      <div className="flex items-center gap-3">
        {isAdmin && (
          <button
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}
        <span className="text-sm font-medium text-foreground">
          {column.name}
        </span>
        {issueCount !== undefined && issueCount > 0 && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {issueCount} {issueCount === 1 ? "issue" : "issues"}
          </span>
        )}
      </div>
      {isAdmin && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
            title="Edit column"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(column)}
            className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
            title="Delete column"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
