"use client";

import { useState, useCallback, createContext, useContext, useEffect, Suspense } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import type { ViewType, GroupBy } from "@/lib/design-tokens";
import { useURLState, URLStateProvider } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface AppShellContextValue {
  // URL-synced state (read from useURLState)
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  groupBy: GroupBy;
  setGroupBy: (groupBy: GroupBy) => void;
  isCreateIssueOpen: boolean;
  setCreateIssueOpen: (open: boolean) => void;

  // Local UI state
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
  selectedIssueId: string | null;
  setSelectedIssueId: (id: string | null) => void;
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
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

function AppShellContent({
  children,
  title = "All Issues",
  issueCount,
}: AppShellProps) {
  const { urlState, setView, setGroupBy, setCreate, setIssue } = useURLState();

  // Local UI state (not in URL)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Detail panel is open when there's an issue in URL
  const detailPanelOpen = !!urlState.issue;

  const setDetailPanelOpen = useCallback(
    (open: boolean) => {
      if (!open) {
        setSelectedIssueId(null);
        setIssue(null);
      }
    },
    [setIssue]
  );

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
        setCreate(true);
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
        } else if (urlState.create) {
          setCreate(false);
        } else if (detailPanelOpen) {
          setDetailPanelOpen(false);
        }
      }
    },
    [isCommandPaletteOpen, urlState.create, detailPanelOpen, toggleSidebar, setCreate, setDetailPanelOpen]
  );

  // Register global keyboard listener
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const contextValue: AppShellContextValue = {
    currentView: urlState.view,
    setCurrentView: setView,
    groupBy: urlState.groupBy,
    setGroupBy,
    isCreateIssueOpen: urlState.create,
    setCreateIssueOpen: setCreate,
    sidebarCollapsed,
    toggleSidebar,
    detailPanelOpen,
    setDetailPanelOpen,
    selectedIssueId,
    setSelectedIssueId,
    isCommandPaletteOpen,
    setCommandPaletteOpen,
  };

  return (
    <AppShellContext.Provider value={contextValue}>
      <div className="flex h-screen bg-background overflow-hidden">
        <Sidebar />

        <div className="flex flex-col flex-1 min-w-0">
          <Header title={title} issueCount={issueCount} />

          <div className="flex flex-1 min-h-0">
            <main
              className={cn(
                "flex-1 overflow-auto scrollbar-thin",
                detailPanelOpen && "border-r border-border"
              )}
            >
              {children}
            </main>

            {detailPanelOpen && (
              <aside className="w-[480px] flex-shrink-0 bg-background overflow-auto scrollbar-thin" />
            )}
          </div>
        </div>
      </div>
    </AppShellContext.Provider>
  );
}

function AppShellLoading({
  children,
  title = "All Issues",
  issueCount,
}: AppShellProps) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className="w-60 border-r border-border" />
      <div className="flex flex-col flex-1 min-w-0">
        <div className="h-14 border-b border-border px-4 flex items-center">
          <span className="font-semibold">{title}</span>
          {issueCount !== undefined && (
            <span className="ml-2 text-muted-foreground text-sm">{issueCount}</span>
          )}
        </div>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  return (
    <Suspense fallback={<AppShellLoading {...props} />}>
      <URLStateProvider>
        <AppShellContent {...props} />
      </URLStateProvider>
    </Suspense>
  );
}
