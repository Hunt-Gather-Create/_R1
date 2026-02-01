"use client";

import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Editable field component - supports single-line and multiline text editing
 */
export function EditableField({
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

  // Sync editValue when entering edit mode
  const startEditing = () => {
    setEditValue(value);
    setIsEditing(true);
  };

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
        <h4 className="text-sm font-medium text-foreground">{label}</h4>
        {!isEditing && (
          <button
            onClick={startEditing}
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

/**
 * List field component - for arrays with add/remove functionality
 */
export function ListField({
  label,
  items,
  onChange,
  placeholder,
  emptyText,
  variant,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  variant?: "success" | "destructive";
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

  const labelColor = variant === "success"
    ? "text-green-600"
    : variant === "destructive"
    ? "text-red-600"
    : "text-foreground";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className={cn("text-sm font-medium", labelColor)}>
          {label} ({items.length})
        </h4>
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

/**
 * Tag list field - displays items as inline tags with add/remove
 */
export function TagListField({
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
        <h4 className="text-sm font-medium text-foreground">
          {label} ({items.length})
        </h4>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-2">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {items.map((item, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 px-2 py-1 bg-muted rounded text-sm group"
            >
              {item}
              <button
                onClick={() => handleRemove(index)}
                className="p-0.5 rounded text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
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
