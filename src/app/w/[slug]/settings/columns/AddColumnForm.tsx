"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { createColumn } from "@/lib/actions/columns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AddColumnFormProps {
  workspaceId: string;
  onCreated: () => void;
}

export function AddColumnForm({ workspaceId, onCreated }: AddColumnFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      await createColumn(workspaceId, name.trim());
      setName("");
      setIsOpen(false);
      onCreated();
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    setName("");
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <Button onClick={() => setIsOpen(true)} className="gap-2">
        <Plus className="w-4 h-4" />
        Add Column
      </Button>
    );
  }

  return (
    <div className="p-6 bg-card rounded-lg border border-border">
      <h3 className="text-sm font-medium text-foreground mb-4">
        Create new column
      </h3>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Column name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") handleCancel();
            }}
          />
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
