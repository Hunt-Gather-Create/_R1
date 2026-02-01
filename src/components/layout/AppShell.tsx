"use client";

import {
  useState,
  useCallback,
  createContext,
  useContext,
  useEffect,
  useRef,
  Suspense,
} from "react";
import { usePathname } from "next/navigation";
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
  isAIPlanningOpen: boolean;
  setAIPlanningOpen: (open: boolean) => void;
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
  const pathname = usePathname();

  // Extract workspace slug from pathname (e.g., /w/my-workspace/... -> my-workspace)
  const workspaceSlug = pathname.match(/^\/w\/([^/]+)/)?.[1];

  // Local UI state (not in URL)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isAIPlanningOpen, setAIPlanningOpen] = useState(false);

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

  // Chord shortcut state (for sequences like "g b", "g l")
  const chordKeyRef = useRef<string | null>(null);
  const chordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearChord = useCallback(() => {
    chordKeyRef.current = null;
    if (chordTimeoutRef.current) {
      clearTimeout(chordTimeoutRef.current);
      chordTimeoutRef.current = null;
    }
  }, []);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isInInput =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable;

      // Command/Ctrl + K for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        clearChord();
        setCommandPaletteOpen(true);
        return;
      }

      // Escape to close panels
      if (e.key === "Escape") {
        clearChord();
        if (isCommandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else if (isAIPlanningOpen) {
          setAIPlanningOpen(false);
        } else if (urlState.create) {
          setCreate(false);
        } else if (detailPanelOpen) {
          setDetailPanelOpen(false);
        }
        return;
      }

      // Skip other shortcuts when in input fields
      if (isInInput) {
        clearChord();
        return;
      }

      // Skip if modifier keys are pressed (except for specific combos handled above)
      if (e.metaKey || e.ctrlKey || e.altKey) {
        clearChord();
        return;
      }

      const key = e.key.toLowerCase();

      // Handle chord sequences (e.g., "g b" for go to board, "g a" for go to AI chat)
      if (chordKeyRef.current === "g") {
        clearChord();
        if (key === "b") {
          e.preventDefault();
          setView("board");
          return;
        } else if (key === "l") {
          e.preventDefault();
          setView("list");
          return;
        } else if (key === "a" && workspaceSlug) {
          e.preventDefault();
          // Use full page navigation for chat to ensure proper data loading
          window.location.href = `/w/${workspaceSlug}/chat`;
          return;
        }
        // If not a valid second key, fall through to check single-key shortcuts
      }

      // Start a chord sequence with "g"
      if (key === "g") {
        e.preventDefault();
        chordKeyRef.current = "g";
        // Clear chord after 1 second if no follow-up key
        chordTimeoutRef.current = setTimeout(clearChord, 1000);
        return;
      }

      // Single-key shortcuts (clear any pending chord)
      clearChord();

      // C for create issue
      if (key === "c") {
        e.preventDefault();
        setCreate(true);
        return;
      }

      // P for AI planning
      if (key === "p") {
        e.preventDefault();
        setAIPlanningOpen(true);
        return;
      }

      // [ to toggle sidebar
      if (key === "[") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
    },
    [
      isCommandPaletteOpen,
      isAIPlanningOpen,
      urlState.create,
      detailPanelOpen,
      toggleSidebar,
      setCreate,
      setDetailPanelOpen,
      setView,
      clearChord,
      workspaceSlug,
    ]
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
    isAIPlanningOpen,
    setAIPlanningOpen,
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
            <span className="ml-2 text-muted-foreground text-sm">
              {issueCount}
            </span>
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
