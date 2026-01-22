"use client";

import { useState, useCallback, createContext, useContext, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { VIEW, GROUP_BY, type ViewType, type GroupBy } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface AppShellContextValue {
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  groupBy: GroupBy;
  setGroupBy: (groupBy: GroupBy) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  selectedIssueId: string | null;
  setSelectedIssueId: (id: string | null) => void;
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  isCreateIssueOpen: boolean;
  setCreateIssueOpen: (open: boolean) => void;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) {
    throw new Error("useAppShell must be used within AppShellProvider");
  }
  return context;
}

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  issueCount?: number;
}

export function AppShell({
  children,
  title = "All Issues",
  issueCount,
}: AppShellProps) {
  const [currentView, setCurrentView] = useState<ViewType>(VIEW.BOARD);
  const [groupBy, setGroupBy] = useState<GroupBy>(GROUP_BY.STATUS);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isCreateIssueOpen, setCreateIssueOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Command/Ctrl + K for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }

      // C for create issue (only when not in input)
      if (
        e.key === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        setCreateIssueOpen(true);
      }

      // [ to toggle sidebar
      if (
        e.key === "[" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        toggleSidebar();
      }

      // Escape to close panels
      if (e.key === "Escape") {
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else if (isCreateIssueOpen) {
          setCreateIssueOpen(false);
        } else if (detailPanelOpen) {
          setDetailPanelOpen(false);
          setSelectedIssueId(null);
        }
      }
    },
    [isCommandPaletteOpen, isCreateIssueOpen, detailPanelOpen, toggleSidebar]
  );

  // Register global keyboard listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => handleKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleKeyDown]);

  const contextValue: AppShellContextValue = {
    currentView,
    setCurrentView,
    groupBy,
    setGroupBy,
    sidebarCollapsed,
    toggleSidebar,
    detailPanelOpen,
    setDetailPanelOpen,
    selectedIssueId,
    setSelectedIssueId,
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    isCreateIssueOpen,
    setCreateIssueOpen,
  };

  return (
    <AppShellContext.Provider value={contextValue}>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <div className="flex flex-col flex-1 min-w-0">
          <Header title={title} issueCount={issueCount} />

          {/* Content with optional detail panel */}
          <div className="flex flex-1 min-h-0">
            {/* Main content */}
            <main
              className={cn(
                "flex-1 overflow-auto scrollbar-thin",
                detailPanelOpen && "border-r border-border"
              )}
            >
              {children}
            </main>

            {/* Detail Panel Slot - rendered by children */}
            {detailPanelOpen && (
              <aside className="w-[480px] flex-shrink-0 bg-background overflow-auto scrollbar-thin">
                {/* IssueDetailPanel will be rendered here via portal or context */}
              </aside>
            )}
          </div>
        </div>
      </div>
    </AppShellContext.Provider>
  );
}
