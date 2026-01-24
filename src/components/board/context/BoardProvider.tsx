"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useOptimistic,
  useTransition,
  useEffect,
  type ReactNode,
} from "react";
import { useAppShell } from "@/components/layout";
import { useURLState } from "@/lib/hooks";
import {
  createIssue,
  updateIssue as updateIssueAction,
  deleteIssue as deleteIssueAction,
  moveIssue,
  addLabel as addLabelAction,
  removeLabel as removeLabelAction,
} from "@/lib/actions/issues";
import { getWorkspaceWithIssues } from "@/lib/actions/board";
import { issueReducer } from "./IssueContext";
import type {
  BoardWithColumnsAndIssues,
  WorkspaceWithColumnsAndIssues,
  IssueWithLabels,
  ColumnWithIssues,
  CreateIssueInput,
  UpdateIssueInput,
  Label,
  Cycle,
} from "@/lib/types";
import { STATUS, type WorkspacePurpose } from "@/lib/design-tokens";

interface BoardContextValue {
  board: BoardWithColumnsAndIssues;
  workspacePurpose: WorkspacePurpose;
  isLoading: boolean;
  refreshBoard: () => Promise<void>;

  findColumn: (issueId: string) => ColumnWithIssues | undefined;
  findIssue: (issueId: string) => IssueWithLabels | undefined;
  findIssueByIdentifier: (identifier: string) => IssueWithLabels | undefined;
  allIssues: IssueWithLabels[];
  labels: Label[];
  cycles: Cycle[];

  addIssue: (columnId: string, input: CreateIssueInput) => void;
  updateIssue: (issueId: string, data: UpdateIssueInput) => void;
  removeIssue: (issueId: string) => void;
  moveIssueToColumn: (issueId: string, targetColumnId: string, targetPosition: number) => void;
  addLabelToIssue: (issueId: string, labelId: string) => void;
  removeLabelFromIssue: (issueId: string, labelId: string) => void;

  selectedIssue: IssueWithLabels | null;
  selectIssue: (issue: IssueWithLabels) => void;
  closeDetailPanel: () => void;

  updateSelectedIssue: (data: UpdateIssueInput) => void;
  deleteSelectedIssue: () => void;
  addLabelToSelectedIssue: (labelId: string) => void;
  removeLabelFromSelectedIssue: (labelId: string) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoardContext() {
  const context = useContext(BoardContext);
  if (!context) {
    throw new Error("useBoardContext must be used within a BoardProvider");
  }
  return context;
}

interface BoardProviderProps {
  initialBoard: BoardWithColumnsAndIssues | WorkspaceWithColumnsAndIssues;
  workspaceId?: string;
  children: ReactNode;
}

export function BoardProvider({ initialBoard, workspaceId, children }: BoardProviderProps) {
  const { selectedIssueId, setSelectedIssueId, setDetailPanelOpen } = useAppShell();
  const { urlState, setIssue } = useURLState();

  const [serverBoard, setServerBoard] = useState(initialBoard);
  const [isLoading, setIsLoading] = useState(false);
  const [board, addOptimistic] = useOptimistic(serverBoard, issueReducer);
  const [, startTransition] = useTransition();

  const refreshBoard = useCallback(async () => {
    const id = workspaceId ?? initialBoard.id;
    if (!id) return;

    setIsLoading(true);
    try {
      const newBoard = await getWorkspaceWithIssues(id);
      setServerBoard(newBoard);
    } catch (error) {
      console.error("Failed to refresh board:", error);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, initialBoard.id]);

  useEffect(() => {
    setServerBoard(initialBoard);
  }, [initialBoard]);

  // Generic issue finder - DRY helper
  const findIssueBy = useCallback(
    <K extends keyof IssueWithLabels>(key: K, value: IssueWithLabels[K]): IssueWithLabels | undefined => {
      for (const col of board.columns) {
        const issue = col.issues.find((i) => i[key] === value);
        if (issue) return issue;
      }
      return undefined;
    },
    [board.columns]
  );

  const findColumn = useCallback(
    (issueId: string): ColumnWithIssues | undefined => {
      return board.columns.find((col) => col.issues.some((issue) => issue.id === issueId));
    },
    [board.columns]
  );

  const findIssue = useCallback(
    (issueId: string) => findIssueBy("id", issueId),
    [findIssueBy]
  );

  const findIssueByIdentifier = useCallback(
    (identifier: string) => findIssueBy("identifier", identifier),
    [findIssueBy]
  );

  const allIssues = board.columns.flatMap((col) => col.issues);

  // Selected issue derived from URL identifier
  const selectedIssue = selectedIssueId ? findIssue(selectedIssueId) ?? null : null;

  const selectIssue = useCallback(
    (issue: IssueWithLabels) => {
      setSelectedIssueId(issue.id);
      setIssue(issue.identifier);
    },
    [setSelectedIssueId, setIssue]
  );

  // Sync issue from URL on mount/when board data loads
  useEffect(() => {
    if (urlState.issue && !selectedIssueId) {
      const issue = findIssueByIdentifier(urlState.issue);
      if (issue) {
        setSelectedIssueId(issue.id);
      }
    }
  }, [urlState.issue, selectedIssueId, findIssueByIdentifier, setSelectedIssueId]);

  const closeDetailPanel = useCallback(() => {
    setDetailPanelOpen(false);
  }, [setDetailPanelOpen]);

  // Issue operations with optimistic updates
  const addIssue = useCallback(
    (columnId: string, input: CreateIssueInput) => {
      const tempIssue: IssueWithLabels = {
        id: crypto.randomUUID(),
        columnId,
        identifier: "...",
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? STATUS.TODO,
        priority: input.priority ?? 4,
        estimate: input.estimate ?? null,
        dueDate: input.dueDate ?? null,
        cycleId: input.cycleId ?? null,
        position: board.columns.find((c) => c.id === columnId)?.issues.length ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        labels: [],
      };

      startTransition(async () => {
        addOptimistic({ type: "addIssue", columnId, issue: tempIssue });
        await createIssue(columnId, input);
        await refreshBoard();
      });
    },
    [board.columns, addOptimistic, refreshBoard]
  );

  const updateIssue = useCallback(
    (issueId: string, data: UpdateIssueInput) => {
      startTransition(async () => {
        addOptimistic({ type: "updateIssue", issueId, data });
        await updateIssueAction(issueId, data);
        await refreshBoard();
      });
    },
    [addOptimistic, refreshBoard]
  );

  const removeIssue = useCallback(
    (issueId: string) => {
      startTransition(async () => {
        addOptimistic({ type: "deleteIssue", issueId });
        await deleteIssueAction(issueId);
        await refreshBoard();
      });
    },
    [addOptimistic, refreshBoard]
  );

  const moveIssueToColumn = useCallback(
    (issueId: string, targetColumnId: string, targetPosition: number) => {
      startTransition(async () => {
        addOptimistic({ type: "moveIssue", issueId, targetColumnId, targetPosition });
        await moveIssue(issueId, targetColumnId, targetPosition);
        await refreshBoard();
      });
    },
    [addOptimistic, refreshBoard]
  );

  const addLabelToIssue = useCallback(
    (issueId: string, labelId: string) => {
      const label = board.labels.find((l) => l.id === labelId);
      if (!label) return;

      const issue = findIssue(issueId);
      if (issue?.labels.some((l) => l.id === labelId)) return;

      startTransition(async () => {
        addOptimistic({ type: "addLabel", issueId, label });
        await addLabelAction(issueId, labelId);
        await refreshBoard();
      });
    },
    [board.labels, addOptimistic, refreshBoard, findIssue]
  );

  const removeLabelFromIssue = useCallback(
    (issueId: string, labelId: string) => {
      startTransition(async () => {
        addOptimistic({ type: "removeLabel", issueId, labelId });
        await removeLabelAction(issueId, labelId);
        await refreshBoard();
      });
    },
    [addOptimistic, refreshBoard]
  );

  // Selected issue convenience methods
  const updateSelectedIssue = useCallback(
    (data: UpdateIssueInput) => {
      if (selectedIssueId) updateIssue(selectedIssueId, data);
    },
    [selectedIssueId, updateIssue]
  );

  const deleteSelectedIssue = useCallback(() => {
    if (selectedIssueId) {
      removeIssue(selectedIssueId);
      closeDetailPanel();
    }
  }, [selectedIssueId, removeIssue, closeDetailPanel]);

  const addLabelToSelectedIssue = useCallback(
    (labelId: string) => {
      if (selectedIssueId) addLabelToIssue(selectedIssueId, labelId);
    },
    [selectedIssueId, addLabelToIssue]
  );

  const removeLabelFromSelectedIssue = useCallback(
    (labelId: string) => {
      if (selectedIssueId) removeLabelFromIssue(selectedIssueId, labelId);
    },
    [selectedIssueId, removeLabelFromIssue]
  );

  const workspacePurpose: WorkspacePurpose =
    ("purpose" in board && (board.purpose === "software" || board.purpose === "marketing"))
      ? board.purpose
      : "software";

  const value: BoardContextValue = {
    board,
    workspacePurpose,
    isLoading,
    refreshBoard,
    findColumn,
    findIssue,
    findIssueByIdentifier,
    allIssues,
    labels: board.labels,
    cycles: board.cycles,
    addIssue,
    updateIssue,
    removeIssue,
    moveIssueToColumn,
    addLabelToIssue,
    removeLabelFromIssue,
    selectedIssue,
    selectIssue,
    closeDetailPanel,
    updateSelectedIssue,
    deleteSelectedIssue,
    addLabelToSelectedIssue,
    removeLabelFromSelectedIssue,
  };

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}
