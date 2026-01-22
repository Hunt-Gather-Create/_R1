"use client";

import { useEffect, useState } from "react";
import { BoardView } from "@/components/board/BoardView";
import { ListView } from "@/components/list";
import { IssueDetailDrawer, CreateIssueDrawer } from "@/components/issues";
import { CommandPalette } from "@/components/command/CommandPalette";
import { AppShell, useAppShell } from "@/components/layout";
import { BoardProvider, useBoardContext } from "@/components/board/context";
import { VIEW } from "@/lib/design-tokens";
import { getOrCreateDefaultBoardWithIssues } from "@/lib/actions/board";
import type { BoardWithColumnsAndIssues } from "@/lib/types";

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
  } = useAppShell();

  const {
    board,
    labels,
    selectedIssue,
    selectIssue,
    closeDetailPanel,
    updateSelectedIssue,
    deleteSelectedIssue,
    addLabelToSelectedIssue,
    removeLabelFromSelectedIssue,
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
              <ListView initialBoard={board} onIssueSelect={selectIssue} />
            </div>
          )}
        </div>
      </div>

      {/* Issue Detail Drawer (replaces inline panel) */}
      <IssueDetailDrawer
        open={detailPanelOpen && !!selectedIssue}
        onOpenChange={(open) => !open && closeDetailPanel()}
        issue={selectedIssue}
        allLabels={labels}
        onUpdate={updateSelectedIssue}
        onDelete={deleteSelectedIssue}
        onAddLabel={addLabelToSelectedIssue}
        onRemoveLabel={removeLabelFromSelectedIssue}
      />

      {/* Command Palette - now uses context directly */}
      <CommandPalette />

      {/* Create Issue Drawer */}
      <CreateIssueDrawer
        open={isCreateIssueOpen}
        onOpenChange={setCreateIssueOpen}
      />
    </>
  );
}

/**
 * Wrapper that provides BoardContext after initial data is loaded.
 */
function BoardContent({ initialBoard }: { initialBoard: BoardWithColumnsAndIssues }) {
  const issueCount = initialBoard.columns.reduce(
    (acc, col) => acc + col.issues.length,
    0
  );

  return (
    <AppShell title="All Issues" issueCount={issueCount}>
      <BoardProvider initialBoard={initialBoard}>
        <MainContent />
      </BoardProvider>
    </AppShell>
  );
}

/**
 * Home page - loads initial board data then renders the app.
 */
export default function Home() {
  const [board, setBoard] = useState<BoardWithColumnsAndIssues | null>(null);

  useEffect(() => {
    getOrCreateDefaultBoardWithIssues().then(setBoard);
  }, []);

  if (!board) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return <BoardContent initialBoard={board} />;
}
