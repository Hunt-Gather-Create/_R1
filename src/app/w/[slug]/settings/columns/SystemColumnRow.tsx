"use client";

import { AlertTriangle } from "lucide-react";
import type { Column } from "@/lib/types";

interface SystemColumnRowProps {
  column: Column;
  issueCount?: number;
}

export function SystemColumnRow({ column, issueCount }: SystemColumnRowProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border last:border-b-0 bg-muted/30">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-medium text-foreground">
          {column.name}
        </span>
        {issueCount !== undefined && issueCount > 0 && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {issueCount} {issueCount === 1 ? "issue" : "issues"}
          </span>
        )}
      </div>
      <span className="text-xs text-muted-foreground">Auto-managed</span>
    </div>
  );
}
