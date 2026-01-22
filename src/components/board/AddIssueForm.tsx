"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface AddIssueFormProps {
  onAdd: (title: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  className?: string;
}

export function AddIssueForm({
  onAdd,
  onCancel,
  autoFocus = false,
  className,
}: AddIssueFormProps) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    onAdd(trimmedTitle);
    setTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setTitle("");
      onCancel?.();
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("w-full", className)}>
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!title.trim()) {
            onCancel?.();
          }
        }}
        placeholder="Issue title..."
        className={cn(
          "w-full px-3 py-2 text-sm rounded-md",
          "bg-card border border-border",
          "text-foreground placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent",
          "transition-colors"
        )}
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-[10px] text-muted-foreground">
          Press Enter to create, Esc to cancel
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            Create
          </button>
        </div>
      </div>
    </form>
  );
}
