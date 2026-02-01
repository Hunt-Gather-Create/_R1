"use client";

import { useState, useMemo, useCallback } from "react";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { StatusDot } from "@/components/issues/StatusDot";
import { PriorityIcon } from "@/components/issues/PriorityIcon";
import { LayoutGrid, List, Plus, Search, SidebarClose } from "lucide-react";
import {
  createNavigationCommands,
  createActionCommands,
  searchIssues,
} from "@/lib/commands";
import { useAppShell } from "@/components/layout";
import { useBoardContext } from "@/components/board/context";
import { VIEW } from "@/lib/design-tokens";
import type { IssueWithLabels } from "@/lib/types";
import type { Status, Priority } from "@/lib/design-tokens";

const iconMap: Record<string, React.ReactNode> = {
  "go-to-board": <LayoutGrid className="w-4 h-4" />,
  "go-to-list": <List className="w-4 h-4" />,
  "toggle-sidebar": <SidebarClose className="w-4 h-4" />,
  "create-issue": <Plus className="w-4 h-4" />,
  "open-search": <Search className="w-4 h-4" />,
};

export function CommandPalette() {
  const {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    setCurrentView,
    toggleSidebar,
    setCreateIssueOpen,
  } = useAppShell();

  const { allIssues, selectIssue } = useBoardContext();

  const [query, setQuery] = useState("");

  // Reset query when dialog closes (handled in onOpenChange, not effect)
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setQuery("");
    }
    setCommandPaletteOpen(open);
  };

  // Build navigation commands
  const navigationCommands = useMemo(
    () =>
      createNavigationCommands({
        goToBoard: () => {
          setCurrentView(VIEW.BOARD);
          setCommandPaletteOpen(false);
        },
        goToList: () => {
          setCurrentView(VIEW.LIST);
          setCommandPaletteOpen(false);
        },
        toggleSidebar: () => {
          toggleSidebar();
          setCommandPaletteOpen(false);
        },
      }),
    [setCurrentView, toggleSidebar, setCommandPaletteOpen]
  );

  // Build action commands
  const actionCommands = useMemo(
    () =>
      createActionCommands({
        createIssue: () => {
          setCreateIssueOpen(true);
          setCommandPaletteOpen(false);
        },
        openSearch: () => {
          // Already in search, just focus
        },
      }),
    [setCreateIssueOpen, setCommandPaletteOpen]
  );

  // Search issues
  const filteredIssues = useMemo(
    () => searchIssues(allIssues, query),
    [allIssues, query]
  );

  const handleSelectIssue = useCallback(
    (issue: IssueWithLabels) => {
      selectIssue(issue);
      setCommandPaletteOpen(false);
    },
    [selectIssue, setCommandPaletteOpen]
  );

  // Don't show navigation/action commands when there's a query
  const showStaticCommands = !query;

  return (
    <Dialog open={isCommandPaletteOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg max-w-[640px]">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
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
                    <StatusDot status={issue.status as Status} size="sm" />
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
                <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">
                  ↑↓
                </kbd>{" "}
                Navigate
              </span>
              <span>
                <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">
                  ↵
                </kbd>{" "}
                Select
              </span>
              <span>
                <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">
                  esc
                </kbd>{" "}
                Close
              </span>
            </div>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
