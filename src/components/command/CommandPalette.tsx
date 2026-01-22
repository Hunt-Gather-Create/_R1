"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { StatusDot } from "@/components/issues/StatusDot";
import { PriorityIcon } from "@/components/issues/PriorityIcon";
import {
  LayoutGrid,
  List,
  Plus,
  Search,
  Settings,
  SidebarClose,
  FileText,
} from "lucide-react";
import {
  createNavigationCommands,
  createActionCommands,
  searchIssues,
} from "@/lib/commands";
import type { IssueWithLabels } from "@/lib/types";
import type { Status, Priority } from "@/lib/design-tokens";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: IssueWithLabels[];
  onSelectIssue: (issue: IssueWithLabels) => void;
  onCreateIssue: () => void;
  onGoToBoard: () => void;
  onGoToList: () => void;
  onToggleSidebar: () => void;
}

const iconMap: Record<string, React.ReactNode> = {
  "go-to-board": <LayoutGrid className="w-4 h-4" />,
  "go-to-list": <List className="w-4 h-4" />,
  "toggle-sidebar": <SidebarClose className="w-4 h-4" />,
  "create-issue": <Plus className="w-4 h-4" />,
  "open-search": <Search className="w-4 h-4" />,
};

export function CommandPalette({
  open,
  onOpenChange,
  issues,
  onSelectIssue,
  onCreateIssue,
  onGoToBoard,
  onGoToList,
  onToggleSidebar,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  // Reset query when closed
  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  // Build navigation commands
  const navigationCommands = useMemo(
    () =>
      createNavigationCommands({
        goToBoard: () => {
          onGoToBoard();
          onOpenChange(false);
        },
        goToList: () => {
          onGoToList();
          onOpenChange(false);
        },
        toggleSidebar: () => {
          onToggleSidebar();
          onOpenChange(false);
        },
      }),
    [onGoToBoard, onGoToList, onToggleSidebar, onOpenChange]
  );

  // Build action commands
  const actionCommands = useMemo(
    () =>
      createActionCommands({
        createIssue: () => {
          onCreateIssue();
          onOpenChange(false);
        },
        openSearch: () => {
          // Already in search, just focus
        },
      }),
    [onCreateIssue, onOpenChange]
  );

  // Search issues
  const filteredIssues = useMemo(
    () => searchIssues(issues, query),
    [issues, query]
  );

  const handleSelectIssue = useCallback(
    (issue: IssueWithLabels) => {
      onSelectIssue(issue);
      onOpenChange(false);
    },
    [onSelectIssue, onOpenChange]
  );

  // Don't show navigation/action commands when there's a query
  const showStaticCommands = !query;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg max-w-[640px]">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput
            placeholder="Search issues or type a command..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            {/* Issues results */}
            {filteredIssues.length > 0 && (
              <CommandGroup heading="Issues">
                {filteredIssues.map((issue) => (
                  <CommandItem
                    key={issue.id}
                    value={`${issue.identifier} ${issue.title}`}
                    onSelect={() => handleSelectIssue(issue)}
                    className="flex items-center gap-2 py-2"
                  >
                    <StatusDot
                      status={issue.status as Status}
                      size="sm"
                    />
                    <span className="text-xs text-muted-foreground font-mono w-16">
                      {issue.identifier}
                    </span>
                    <span className="flex-1 truncate">{issue.title}</span>
                    <PriorityIcon
                      priority={issue.priority as Priority}
                      size="sm"
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {showStaticCommands && (
              <>
                {filteredIssues.length > 0 && <CommandSeparator />}

                {/* Navigation */}
                <CommandGroup heading="Navigation">
                  {navigationCommands.map((cmd) => (
                    <CommandItem
                      key={cmd.id}
                      value={cmd.label}
                      onSelect={cmd.action}
                    >
                      {iconMap[cmd.id]}
                      <span>{cmd.label}</span>
                      {cmd.shortcut && (
                        <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />

                {/* Actions */}
                <CommandGroup heading="Actions">
                  {actionCommands.map((cmd) => (
                    <CommandItem
                      key={cmd.id}
                      value={cmd.label}
                      onSelect={cmd.action}
                    >
                      {iconMap[cmd.id]}
                      <span>{cmd.label}</span>
                      {cmd.shortcut && (
                        <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>

          {/* Footer */}
          <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>
                <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd>{" "}
                Navigate
              </span>
              <span>
                <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↵</kbd>{" "}
                Select
              </span>
              <span>
                <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">esc</kbd>{" "}
                Close
              </span>
            </div>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
