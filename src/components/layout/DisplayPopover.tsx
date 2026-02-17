"use client";

import { LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { VIEW, GROUP_BY, type GroupBy, type ViewType } from "@/lib/design-tokens";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useAppShell } from "./AppShell";

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  [GROUP_BY.STATUS]: "Status",
  [GROUP_BY.PRIORITY]: "Priority",
  [GROUP_BY.LABEL]: "Label",
  [GROUP_BY.CYCLE]: "Cycle",
  [GROUP_BY.EPIC]: "Epic",
  [GROUP_BY.NONE]: "No grouping",
};

const VIEW_OPTIONS: { value: ViewType; label: string; icon: typeof LayoutGrid }[] = [
  { value: VIEW.BOARD, label: "Board", icon: LayoutGrid },
  { value: VIEW.LIST, label: "List", icon: List },
];

export function DisplayPopover() {
  const { currentView, setCurrentView, groupBy, setGroupBy } = useAppShell();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 h-8 px-2 text-xs">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Display</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-56 p-3">
        {/* Layout section */}
        <div className="mb-3">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Layout
          </span>
          <div className="flex items-center gap-1 mt-1.5">
            {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setCurrentView(value)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex-1 justify-center",
                  currentView === value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-border mb-3" />

        {/* Grouping section */}
        <div>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Grouping
          </span>
          <div className="flex flex-col gap-0.5 mt-1.5">
            {Object.values(GROUP_BY).map((value) => (
              <button
                key={value}
                onClick={() => setGroupBy(value)}
                className={cn(
                  "flex items-center px-2 py-1.5 rounded-md text-sm transition-colors text-left",
                  groupBy === value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                {GROUP_BY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
