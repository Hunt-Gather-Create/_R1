"use client";

import {
  LayoutGrid,
  List,
  Filter,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VIEW, GROUP_BY, type GroupBy } from "@/lib/design-tokens";
import { Button } from "@/components/ui/button";
import { useAppShell } from "./AppShell";

interface HeaderProps {
  title: string;
  issueCount?: number;
}

function ViewSwitcher() {
  const { currentView, setCurrentView } = useAppShell();

  return (
    <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
      <button
        onClick={() => setCurrentView(VIEW.BOARD)}
        className={cn(
          "flex items-center justify-center w-7 h-7 rounded transition-colors",
          currentView === VIEW.BOARD
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        title="Board view"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
      <button
        onClick={() => setCurrentView(VIEW.LIST)}
        className={cn(
          "flex items-center justify-center w-7 h-7 rounded transition-colors",
          currentView === VIEW.LIST
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        title="List view"
      >
        <List className="w-4 h-4" />
      </button>
    </div>
  );
}

function GroupByDropdown() {
  const { groupBy, setGroupBy } = useAppShell();

  const groupByLabels: Record<GroupBy, string> = {
    [GROUP_BY.STATUS]: "Status",
    [GROUP_BY.PRIORITY]: "Priority",
    [GROUP_BY.LABEL]: "Label",
    [GROUP_BY.CYCLE]: "Cycle",
    [GROUP_BY.NONE]: "No grouping",
  };

  return (
    <div className="relative group">
      <Button variant="ghost" size="sm" className="gap-1 h-8 px-2 text-xs">
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span>Group: {groupByLabels[groupBy]}</span>
        <ChevronDown className="w-3 h-3 opacity-50" />
      </Button>
      <div className="absolute top-full left-0 mt-1 w-40 py-1 bg-popover border border-border rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
        {Object.entries(GROUP_BY).map(([key, value]) => (
          <button
            key={key}
            onClick={() => setGroupBy(value)}
            className={cn(
              "w-full px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors",
              groupBy === value && "bg-accent text-accent-foreground"
            )}
          >
            {groupByLabels[value]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Header({
  title,
  issueCount,
}: HeaderProps) {
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

        <GroupByDropdown />

        <div className="w-px h-5 bg-border mx-1" />

        <ViewSwitcher />
      </div>
    </header>
  );
}
