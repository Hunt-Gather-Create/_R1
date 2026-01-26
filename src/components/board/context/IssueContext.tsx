"use client";

import {
  createContext,
  useContext,
  useOptimistic,
  useTransition,
  type ReactNode,
} from "react";
import {
  createIssue,
  updateIssue,
  deleteIssue,
  moveIssue,
  addLabel,
  removeLabel,
} from "@/lib/actions/issues";
import type {
  BoardWithColumnsAndIssues,
  IssueWithLabels,
  ColumnWithIssues,
  CreateIssueInput,
  UpdateIssueInput,
  Label,
  Cycle,
} from "@/lib/types";
import type { Status, Priority } from "@/lib/design-tokens";
import { STATUS } from "@/lib/design-tokens";

export type OptimisticAction =
  | { type: "addIssue"; columnId: string; issue: IssueWithLabels }
  | { type: "updateIssue"; issueId: string; data: UpdateIssueInput }
  | { type: "deleteIssue"; issueId: string }
  | {
      type: "moveIssue";
      issueId: string;
      targetColumnId: string;
      targetPosition: number;
    }
  | { type: "addLabel"; issueId: string; label: Label }
  | { type: "removeLabel"; issueId: string; labelId: string };

export function issueReducer(
  state: BoardWithColumnsAndIssues,
  action: OptimisticAction
): BoardWithColumnsAndIssues {
  switch (action.type) {
    case "addIssue": {
      return {
        ...state,
        columns: state.columns.map((col) =>
          col.id === action.columnId
            ? { ...col, issues: [...col.issues, action.issue] }
            : col
        ),
      };
    }
    case "updateIssue": {
      return {
        ...state,
        columns: state.columns.map((col) => ({
          ...col,
          issues: col.issues.map((issue) =>
            issue.id === action.issueId
              ? { ...issue, ...action.data, updatedAt: new Date() }
              : issue
          ),
        })),
      };
    }
    case "deleteIssue": {
      return {
        ...state,
        columns: state.columns.map((col) => ({
          ...col,
          issues: col.issues.filter((issue) => issue.id !== action.issueId),
        })),
      };
    }
    case "moveIssue": {
      const { issueId, targetColumnId, targetPosition } = action;
      let movedIssue: IssueWithLabels | null = null;

      const columnsWithoutIssue = state.columns.map((col) => {
        const issueIndex = col.issues.findIndex((i) => i.id === issueId);
        if (issueIndex !== -1) {
          movedIssue = col.issues[issueIndex];
          return {
            ...col,
            issues: col.issues.filter((i) => i.id !== issueId),
          };
        }
        return col;
      });

      if (!movedIssue) return state;

      return {
        ...state,
        columns: columnsWithoutIssue.map((col) => {
          if (col.id === targetColumnId) {
            const newIssues = [...col.issues];
            newIssues.splice(targetPosition, 0, {
              ...movedIssue!,
              columnId: targetColumnId,
              position: targetPosition,
            });
            return {
              ...col,
              issues: newIssues.map((i, idx) => ({ ...i, position: idx })),
            };
          }
          return col;
        }),
      };
    }
    case "addLabel": {
      return {
        ...state,
        columns: state.columns.map((col) => ({
          ...col,
          issues: col.issues.map((issue) =>
            issue.id === action.issueId
              ? {
                  ...issue,
                  // Only add if not already present (prevent duplicates)
                  labels: issue.labels.some((l) => l.id === action.label.id)
                    ? issue.labels
                    : [...issue.labels, action.label],
                }
              : issue
          ),
        })),
      };
    }
    case "removeLabel": {
      return {
        ...state,
        columns: state.columns.map((col) => ({
          ...col,
          issues: col.issues.map((issue) =>
            issue.id === action.issueId
              ? {
                  ...issue,
                  labels: issue.labels.filter((l) => l.id !== action.labelId),
                }
              : issue
          ),
        })),
      };
    }
    default:
      return state;
  }
}

interface IssueContextValue {
  board: BoardWithColumnsAndIssues;
  initialBoard: BoardWithColumnsAndIssues;
  addOptimistic: (action: OptimisticAction) => void;
  startTransition: (callback: () => void) => void;
  findColumn: (issueId: string) => ColumnWithIssues | undefined;
  findIssue: (issueId: string) => IssueWithLabels | undefined;
  labels: Label[];
  cycles: Cycle[];
  addIssue: (columnId: string, input: CreateIssueInput) => void;
  updateIssueData: (issueId: string, data: UpdateIssueInput) => void;
  removeIssue: (issueId: string) => void;
  moveIssueToColumn: (
    issueId: string,
    targetColumnId: string,
    targetPosition: number
  ) => void;
  addLabelToIssue: (issueId: string, labelId: string) => void;
  removeLabelFromIssue: (issueId: string, labelId: string) => void;
}

const IssueContext = createContext<IssueContextValue | null>(null);

interface IssueProviderProps {
  initialBoard: BoardWithColumnsAndIssues;
  children: ReactNode;
  onMutate?: () => void;
}

export function IssueProvider({
  initialBoard,
  children,
  onMutate,
}: IssueProviderProps) {
  const [board, addOptimistic] = useOptimistic(initialBoard, issueReducer);
  const [, startTransition] = useTransition();

  const findColumn = (issueId: string): ColumnWithIssues | undefined => {
    return board.columns.find((col) =>
      col.issues.some((issue) => issue.id === issueId)
    );
  };

  const findIssue = (issueId: string): IssueWithLabels | undefined => {
    for (const col of board.columns) {
      const issue = col.issues.find((i) => i.id === issueId);
      if (issue) return issue;
    }
    return undefined;
  };

  const addIssue = (columnId: string, input: CreateIssueInput) => {
    const tempIssue: IssueWithLabels = {
      id: crypto.randomUUID(),
      columnId,
      identifier: "...", // Will be replaced by server
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
      await createIssue(columnId, input);
      onMutate?.();
    });
  };

  const updateIssueData = (issueId: string, data: UpdateIssueInput) => {
    startTransition(async () => {
      addOptimistic({ type: "updateIssue", issueId, data });
      await updateIssue(issueId, data);
      onMutate?.();
    });
  };

  const removeIssue = (issueId: string) => {
    startTransition(async () => {
      addOptimistic({ type: "deleteIssue", issueId });
      await deleteIssue(issueId);
      onMutate?.();
    });
  };

  const moveIssueToColumn = (
    issueId: string,
    targetColumnId: string,
    targetPosition: number
  ) => {
    startTransition(async () => {
      addOptimistic({
        type: "moveIssue",
        issueId,
        targetColumnId,
        targetPosition,
      });
      await moveIssue(issueId, targetColumnId, targetPosition);
      onMutate?.();
    });
  };

  const addLabelToIssue = (issueId: string, labelId: string) => {
    const label = board.labels.find((l) => l.id === labelId);
    if (!label) return;

    startTransition(async () => {
      addOptimistic({ type: "addLabel", issueId, label });
      await addLabel(issueId, labelId);
    });
  };

  const removeLabelFromIssue = (issueId: string, labelId: string) => {
    startTransition(async () => {
      addOptimistic({ type: "removeLabel", issueId, labelId });
      await removeLabel(issueId, labelId);
    });
  };

  return (
    <IssueContext.Provider
      value={{
        board,
        initialBoard,
        addOptimistic,
        startTransition,
        findColumn,
        findIssue,
        labels: board.labels,
        cycles: board.cycles,
        addIssue,
        updateIssueData,
        removeIssue,
        moveIssueToColumn,
        addLabelToIssue,
        removeLabelFromIssue,
      }}
    >
      {children}
    </IssueContext.Provider>
  );
}

export function useIssueContext() {
  const context = useContext(IssueContext);
  if (!context) {
    throw new Error("useIssueContext must be used within an IssueProvider");
  }
  return context;
}
