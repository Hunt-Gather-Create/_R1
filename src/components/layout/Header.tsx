"use client";

import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisplayPopover } from "./DisplayPopover";

interface HeaderProps {
  title: string;
  issueCount?: number;
}

export function Header({ title, issueCount }: HeaderProps) {
  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-background">
      {/* Left: Title and count */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold">{title}</h1>
        {typeof issueCount === "number" && (
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
            {issueCount} issues
          </span>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1 h-8 px-2 text-xs">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter</span>
        </Button>

        <DisplayPopover />
      </div>
    </header>
  );
}
