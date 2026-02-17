"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BoardView } from "@/components/board/BoardView";
import { ListView } from "@/components/list";
import { AppShell, useAppShell } from "@/components/layout";
import { BoardProvider, useBoardContext } from "@/components/board/context";
import { WorkspaceProvider } from "@/components/workspace";
import { VIEW } from "@/lib/design-tokens";
import { getWorkspaceBySlugWithIssues } from "@/lib/actions/board";
import { getCurrentUser } from "@/lib/auth";
import type { WorkspaceWithColumnsAndIssues } from "@/lib/types";

// Dynamic imports for heavy components - only loaded when needed
const IssueDetailDrawer = dynamic(
  () =>
    import("@/components/issues/IssueDetailDrawer").then(
      (mod) => mod.IssueDetailDrawer
    ),
  { ssr: false }
);

const CreateIssueDrawer = dynamic(
  () =>
    import("@/components/issues/CreateIssueDrawer").then(
      (mod) => mod.CreateIssueDrawer
    ),
  { ssr: false }
);

const CommandPalette = dynamic(
  () =>
    import("@/components/command/CommandPalette").then(
      (mod) => mod.CommandPalette
    ),
  { ssr: false }
);

const AIPlanningSheet = dynamic(
  () =>
    import("@/components/planning/AIPlanningSheet").then(
      (mod) => mod.AIPlanningSheet
    ),
  { ssr: false }
);

const EpicsDrawer = dynamic(
  () =>
    import("@/components/epics/EpicsDrawer").then((mod) => mod.EpicsDrawer),
  { ssr: false }
);

/**
 * Main content area that renders the board/list view and detail panel.
 * Uses BoardContext for all issue operations.
 */
function MainContent() {
  const {
    currentView,
    detailPanelOpen,
    isCreateIssueOpen,
    setCreateIssueOpen,
    isAIPlanningOpen,
    setAIPlanningOpen,
    isEpicsDrawerOpen,
    setEpicsDrawerOpen,
  } = useAppShell();

  const {
    board,
    selectedIssue,
    selectIssue,
    closeDetailPanel,
  } = useBoardContext();

  return (
    <>
      <div className="flex h-full">
        {/* Main content area */}
        <div className="flex-1 min-w-0">
          {currentView === VIEW.BOARD ? (
            <div className="p-4 h-full overflow-auto">
              <BoardView onIssueSelect={selectIssue} />
            </div>
          ) : (
            <div className="relative h-full">
              <ListView onIssueSelect={selectIssue} />
            </div>
          )}
        </div>
      </div>

      {/* Issue Detail Drawer */}
      <IssueDetailDrawer
        open={detailPanelOpen && !!selectedIssue}
        onOpenChange={(open) => !open && closeDetailPanel()}
      />

      {/* Command Palette */}
      <CommandPalette />

      {/* Create Issue Drawer */}
      <CreateIssueDrawer
        open={isCreateIssueOpen}
        onOpenChange={setCreateIssueOpen}
      />

      {/* AI Planning Sheet */}
      <AIPlanningSheet
        open={isAIPlanningOpen}
        onOpenChange={setAIPlanningOpen}
      />

      {/* Epics Drawer */}
      <EpicsDrawer
        open={isEpicsDrawerOpen}
        onOpenChange={setEpicsDrawerOpen}
      />
    </>
  );
}

/**
 * Wrapper that provides BoardContext after workspace data is loaded.
 */
function WorkspaceContent({
  workspace,
}: {
  workspace: WorkspaceWithColumnsAndIssues;
}) {
  const issueCount = workspace.columns.reduce(
    (acc, col) => acc + col.issues.length,
    0
  );

  return (
    <AppShell title={workspace.name} issueCount={issueCount}>
      <BoardProvider initialBoard={workspace} workspaceId={workspace.id}>
        <MainContent />
      </BoardProvider>
    </AppShell>
  );
}

/**
 * Workspace page - loads workspace data then renders the app.
 */
export default function WorkspacePage() {
  const params = useParams<{ slug: string }>();
  const [workspace, setWorkspace] =
    useState<WorkspaceWithColumnsAndIssues | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.slug) {
      Promise.all([getWorkspaceBySlugWithIssues(params.slug), getCurrentUser()])
        .then(([workspaceData, user]) => {
          if (workspaceData) {
            setWorkspace(workspaceData);
          } else {
            setError("Workspace not found");
          }
          if (user) {
            setUserId(user.id);
          }
        })
        .catch((err) => {
          setError(err.message || "Failed to load workspace");
        });
    }
  }, [params.slug]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-foreground mb-2">Error</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!workspace || !userId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceProvider workspace={workspace} userId={userId}>
      <WorkspaceContent workspace={workspace} />
    </WorkspaceProvider>
  );
}
