"use client";

import {
  createContext,
  useContext,
  useCallback,
  useOptimistic,
  useTransition,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppShell } from "@/components/layout";
import {
  useURLState,
  useBoardQuery,
  useCreateIssue,
  useUpdateIssue,
  useDeleteIssue,
  useMoveIssue,
  useAddLabelToIssue,
  useRemoveLabelFromIssue,
  useCreateLabel,
} from "@/lib/hooks";
import { queryKeys } from "@/lib/query-keys";
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
import { STATUS, type WorkspacePurpose, type Status } from "@/lib/design-tokens";

interface BoardContextValue {
  board: BoardWithColumnsAndIssues;
  workspaceId: string;
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
  moveIssueToColumn: (
    issueId: string,
    targetColumnId: string,
    targetPosition: number
  ) => void;
  addLabelToIssue: (issueId: string, labelId: string) => void;
  removeLabelFromIssue: (issueId: string, labelId: string) => void;
  createLabel: (name: string, color: string) => Promise<Label | undefined>;

  selectedIssue: IssueWithLabels | null;
  selectIssue: (issue: IssueWithLabels) => void;
  closeDetailPanel: () => void;

  updateSelectedIssue: (data: UpdateIssueInput) => void;
  deleteSelectedIssue: () => void;
  moveSelectedIssueToColumn: (columnId: string) => void;
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

export function BoardProvider({
  initialBoard,
  workspaceId,
  children,
}: BoardProviderProps) {
  const { selectedIssueId, setSelectedIssueId, setDetailPanelOpen } =
    useAppShell();
  const { urlState, setIssue } = useURLState();
  const queryClient = useQueryClient();

  const wsId = workspaceId ?? initialBoard.id;

  // Use TanStack Query for board data
  const { data: serverBoard = initialBoard, isLoading } = useBoardQuery(
    wsId,
    initialBoard
  );

  // Keep useOptimistic for instant UI feedback
  const [board, addOptimistic] = useOptimistic(serverBoard, issueReducer);
  const [, startTransition] = useTransition();

  // Filter subtasks from board view - subtasks only appear in parent's detail panel
  const boardForView = useMemo(
    () => ({
      ...board,
      columns: board.columns.map((col) => ({
        ...col,
        issues: col.issues.filter((issue) => !issue.parentIssueId),
      })),
    }),
    [board]
  );

  // Mutations
  const createIssueMutation = useCreateIssue(wsId);
  const updateIssueMutation = useUpdateIssue(wsId);
  const deleteIssueMutation = useDeleteIssue(wsId);
  const moveIssueMutation = useMoveIssue(wsId);
  const addLabelMutation = useAddLabelToIssue(wsId);
  const removeLabelMutation = useRemoveLabelFromIssue(wsId);
  const createLabelMutation = useCreateLabel(wsId);

  // refreshBoard now just invalidates the query
  const refreshBoard = useCallback(async () => {
    if (!wsId) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.board.detail(wsId),
    });
  }, [wsId, queryClient]);

  // Generic issue finder - DRY helper
  const findIssueBy = useCallback(
    <K extends keyof IssueWithLabels>(
      key: K,
      value: IssueWithLabels[K]
    ): IssueWithLabels | undefined => {
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
      return board.columns.find((col) =>
        col.issues.some((issue) => issue.id === issueId)
      );
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
  const selectedIssue = selectedIssueId
    ? (findIssue(selectedIssueId) ?? null)
    : null;

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
  }, [
    urlState.issue,
    selectedIssueId,
    findIssueByIdentifier,
    setSelectedIssueId,
  ]);

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
        parentIssueId: input.parentIssueId ?? null,
        position:
          board.columns.find((c) => c.id === columnId)?.issues.length ?? 0,
        sentToAI: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        labels: [],
      };

      startTransition(async () => {
        addOptimistic({ type: "addIssue", columnId, issue: tempIssue });
        await createIssueMutation.mutateAsync({ columnId, input });
      });
    },
    [board.columns, addOptimistic, createIssueMutation]
  );

  // Find the column that matches a status based on the column's status field
  const findColumnForStatus = useCallback(
    (status: Status): ColumnWithIssues | undefined => {
      // Find column with matching status field
      return board.columns.find((col) => col.status === status);
    },
    [board.columns]
  );

  const updateIssue = useCallback(
    (issueId: string, data: UpdateIssueInput) => {
      startTransition(async () => {
        // Check if status is changing and we need to move the issue
        // (only for non-subtasks - subtasks stay with their parent)
        if (data.status) {
          const currentIssue = findIssue(issueId);
          const isSubtask = !!currentIssue?.parentIssueId;

          if (!isSubtask) {
            const currentColumn = findColumn(issueId);
            const targetColumn = findColumnForStatus(data.status as Status);

            // If we found a target column that's different from current, move the issue
            if (
              currentIssue &&
              targetColumn &&
              currentColumn &&
              targetColumn.id !== currentColumn.id
            ) {
              // Move to end of target column
              const targetPosition = targetColumn.issues.length;
              addOptimistic({
                type: "moveIssue",
                issueId,
                targetColumnId: targetColumn.id,
                targetPosition,
              });
              // Also apply the status update optimistically
              addOptimistic({ type: "updateIssue", issueId, data });
              await updateIssueMutation.mutateAsync({ issueId, data });
              return;
            }
          }
        }

        // Default: just update the issue without moving
        addOptimistic({ type: "updateIssue", issueId, data });
        await updateIssueMutation.mutateAsync({ issueId, data });
      });
    },
    [addOptimistic, updateIssueMutation, findIssue, findColumn, findColumnForStatus]
  );

  const removeIssue = useCallback(
    (issueId: string) => {
      startTransition(async () => {
        addOptimistic({ type: "deleteIssue", issueId });
        await deleteIssueMutation.mutateAsync(issueId);
      });
    },
    [addOptimistic, deleteIssueMutation]
  );

  const moveIssueToColumn = useCallback(
    (issueId: string, targetColumnId: string, targetPosition: number) => {
      startTransition(async () => {
        addOptimistic({
          type: "moveIssue",
          issueId,
          targetColumnId,
          targetPosition,
        });
        await moveIssueMutation.mutateAsync({
          issueId,
          targetColumnId,
          targetPosition,
        });
      });
    },
    [addOptimistic, moveIssueMutation]
  );

  const addLabelToIssue = useCallback(
    (issueId: string, labelId: string) => {
      const label = board.labels.find((l) => l.id === labelId);
      if (!label) return;

      const issue = findIssue(issueId);
      if (issue?.labels.some((l) => l.id === labelId)) return;

      startTransition(async () => {
        addOptimistic({ type: "addLabel", issueId, label });
        await addLabelMutation.mutateAsync({ issueId, labelId });
      });
    },
    [board.labels, addOptimistic, addLabelMutation, findIssue]
  );

  const removeLabelFromIssue = useCallback(
    (issueId: string, labelId: string) => {
      startTransition(async () => {
        addOptimistic({ type: "removeLabel", issueId, labelId });
        await removeLabelMutation.mutateAsync({ issueId, labelId });
      });
    },
    [addOptimistic, removeLabelMutation]
  );

  const createLabel = useCallback(
    async (name: string, color: string): Promise<Label | undefined> => {
      if (!wsId) return undefined;

      try {
        const newLabel = await createLabelMutation.mutateAsync({ name, color });
        return newLabel;
      } catch (error) {
        console.error("Failed to create label:", error);
        return undefined;
      }
    },
    [wsId, createLabelMutation]
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

  const moveSelectedIssueToColumn = useCallback(
    (columnId: string) => {
      if (!selectedIssueId) return;
      const targetColumn = board.columns.find((c) => c.id === columnId);
      if (!targetColumn) return;
      // Move to end of target column
      const targetPosition = targetColumn.issues.length;
      moveIssueToColumn(selectedIssueId, columnId, targetPosition);
    },
    [selectedIssueId, board.columns, moveIssueToColumn]
  );

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
    "purpose" in board &&
    (board.purpose === "software" || board.purpose === "marketing")
      ? board.purpose
      : "software";

  // Filter allIssues once, memoized
  const filteredAllIssues = useMemo(
    () => allIssues.filter((issue) => !issue.parentIssueId),
    [allIssues]
  );

  // Memoize context value to prevent unnecessary re-renders (rerender-memo rule)
  const value: BoardContextValue = useMemo(
    () => ({
      board: boardForView,
      workspaceId: wsId,
      workspacePurpose,
      isLoading,
      refreshBoard,
      findColumn,
      findIssue,
      findIssueByIdentifier,
      allIssues: filteredAllIssues,
      labels: board.labels,
      cycles: board.cycles,
      addIssue,
      updateIssue,
      removeIssue,
      moveIssueToColumn,
      addLabelToIssue,
      removeLabelFromIssue,
      createLabel,
      selectedIssue,
      selectIssue,
      closeDetailPanel,
      updateSelectedIssue,
      deleteSelectedIssue,
      moveSelectedIssueToColumn,
      addLabelToSelectedIssue,
      removeLabelFromSelectedIssue,
    }),
    [
      boardForView,
      wsId,
      workspacePurpose,
      isLoading,
      refreshBoard,
      findColumn,
      findIssue,
      findIssueByIdentifier,
      filteredAllIssues,
      board.labels,
      board.cycles,
      addIssue,
      updateIssue,
      removeIssue,
      moveIssueToColumn,
      addLabelToIssue,
      removeLabelFromIssue,
      createLabel,
      selectedIssue,
      selectIssue,
      closeDetailPanel,
      updateSelectedIssue,
      deleteSelectedIssue,
      moveSelectedIssueToColumn,
      addLabelToSelectedIssue,
      removeLabelFromSelectedIssue,
    ]
  );

  return (
    <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
  );
}
