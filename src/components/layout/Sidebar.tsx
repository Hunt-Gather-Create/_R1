"use client";

import { useState } from "react";
import {
  LayoutGrid,
  List,
  Settings,
  ChevronLeft,
  ChevronRight,
  Search,
  Plus,
  Inbox,
  Clock,
  Circle,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VIEW, type ViewType } from "@/lib/design-tokens";

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  onCreateIssue: () => void;
  onOpenSearch: () => void;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  isCollapsed: boolean;
  onClick?: () => void;
  shortcut?: string;
}

function NavItem({
  icon,
  label,
  isActive,
  isCollapsed,
  onClick,
  shortcut,
}: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
        "hover:bg-sidebar-accent",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70",
        isCollapsed && "justify-center px-2"
      )}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!isCollapsed && (
        <>
          <span className="flex-1 text-left truncate">{label}</span>
          {shortcut && (
            <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
              {shortcut}
            </kbd>
          )}
        </>
      )}
    </button>
  );
}

interface NavSectionProps {
  title: string;
  isCollapsed: boolean;
  children: React.ReactNode;
}

function NavSection({ title, isCollapsed, children }: NavSectionProps) {
  return (
    <div className="mb-4">
      {!isCollapsed && (
        <h3 className="px-2 mb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </h3>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function Sidebar({
  isCollapsed,
  onToggle,
  currentView,
  onViewChange,
  onCreateIssue,
  onOpenSearch,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-200",
        isCollapsed ? "w-14" : "w-60"
      )}
    >
      {/* Logo/Workspace Header */}
      <div className="flex items-center justify-between h-12 px-3 border-b border-sidebar-border">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-primary rounded flex items-center justify-center">
              <Layers className="w-3 h-3 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm">Workspace</span>
          </div>
        )}
        {isCollapsed && (
          <div className="w-5 h-5 mx-auto bg-primary rounded flex items-center justify-center">
            <Layers className="w-3 h-3 text-primary-foreground" />
          </div>
        )}
        <button
          onClick={onToggle}
          className={cn(
            "p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground",
            isCollapsed && "hidden"
          )}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Actions */}
      <div className="p-2 space-y-1">
        <button
          onClick={onOpenSearch}
          className={cn(
            "flex items-center w-full gap-2 px-2 py-1.5 rounded-md text-sm",
            "bg-sidebar-accent/50 hover:bg-sidebar-accent text-sidebar-foreground/70",
            isCollapsed && "justify-center"
          )}
        >
          <Search className="w-4 h-4 flex-shrink-0" />
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left">Search...</span>
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                ⌘K
              </kbd>
            </>
          )}
        </button>
        <button
          onClick={onCreateIssue}
          className={cn(
            "flex items-center w-full gap-2 px-2 py-1.5 rounded-md text-sm",
            "hover:bg-sidebar-accent text-sidebar-foreground/70",
            isCollapsed && "justify-center"
          )}
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left">New Issue</span>
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                C
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin p-2">
        <NavSection title="Views" isCollapsed={isCollapsed}>
          <NavItem
            icon={<Inbox className="w-4 h-4" />}
            label="Inbox"
            isCollapsed={isCollapsed}
          />
          <NavItem
            icon={<Circle className="w-4 h-4" />}
            label="My Issues"
            isCollapsed={isCollapsed}
          />
        </NavSection>

        <NavSection title="Workspace" isCollapsed={isCollapsed}>
          <NavItem
            icon={<LayoutGrid className="w-4 h-4" />}
            label="Board"
            isActive={currentView === VIEW.BOARD}
            isCollapsed={isCollapsed}
            onClick={() => onViewChange(VIEW.BOARD)}
            shortcut="G B"
          />
          <NavItem
            icon={<List className="w-4 h-4" />}
            label="List"
            isActive={currentView === VIEW.LIST}
            isCollapsed={isCollapsed}
            onClick={() => onViewChange(VIEW.LIST)}
            shortcut="G L"
          />
          <NavItem
            icon={<Clock className="w-4 h-4" />}
            label="Cycles"
            isCollapsed={isCollapsed}
          />
        </NavSection>
      </nav>

      {/* Footer Actions */}
      <div className="p-2 border-t border-sidebar-border">
        <NavItem
          icon={<Settings className="w-4 h-4" />}
          label="Settings"
          isCollapsed={isCollapsed}
        />
        {isCollapsed && (
          <button
            onClick={onToggle}
            className="flex items-center justify-center w-full mt-2 p-1.5 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
