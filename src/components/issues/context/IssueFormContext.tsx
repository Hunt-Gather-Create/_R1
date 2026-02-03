"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { useWorkspaceMembers } from "@/lib/hooks";
import { PRIORITY, type Priority } from "@/lib/design-tokens";
import type { Label, Column, WorkspaceMemberWithUser } from "@/lib/types";

// Suggested subtask from AI
export interface SuggestedSubtask {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
}

export interface IssueFormState {
  title: string;
  description: string;
  columnId: string;
  priority: Priority;
  labelIds: string[];
  dueDate: Date | null;
  estimate: number | null;
  assigneeId: string | null;
}

interface IssueFormContextValue {
  // Form state
  formState: IssueFormState;
  updateForm: (updates: Partial<IssueFormState>) => void;
  resetForm: () => void;

  // Suggested subtasks
  suggestedSubtasks: SuggestedSubtask[];
  addSuggestedSubtasks: (subtasks: Omit<SuggestedSubtask, "id">[]) => void;
  updateSuggestedSubtask: (id: string, updates: Partial<Omit<SuggestedSubtask, "id">>) => void;
  removeSuggestedSubtask: (id: string) => void;
  clearSuggestedSubtasks: () => void;

  // Highlighting for AI suggestions
  highlightedFields: Set<keyof IssueFormState>;
  highlightFields: (fields: (keyof IssueFormState)[]) => void;
  highlightSubtasks: boolean;
  setHighlightSubtasks: (highlight: boolean) => void;

  // Board data
  columns: Column[];
  labels: Label[];
  members: WorkspaceMemberWithUser[];

  // Actions
  onCreateLabel?: (name: string, color: string) => Promise<Label | undefined>;

  // Submission
  isSubmitting: boolean;
  setIsSubmitting: (submitting: boolean) => void;
  canSubmit: boolean;
}

const IssueFormContext = createContext<IssueFormContextValue | null>(null);

export function useIssueFormContext() {
  const context = useContext(IssueFormContext);
  if (!context) {
    throw new Error(
      "useIssueFormContext must be used within an IssueFormProvider"
    );
  }
  return context;
}

// Optional hook that returns null if not in context (for components that work both ways)
export function useIssueFormContextOptional() {
  return useContext(IssueFormContext);
}

interface IssueFormProviderProps {
  children: ReactNode;
  defaultColumnId?: string;
}

function getInitialFormState(defaultColumnId: string): IssueFormState {
  return {
    title: "",
    description: "",
    columnId: defaultColumnId,
    priority: PRIORITY.NONE,
    labelIds: [],
    dueDate: null,
    estimate: null,
    assigneeId: null,
  };
}

export function IssueFormProvider({
  children,
  defaultColumnId: providedDefaultColumnId,
}: IssueFormProviderProps) {
  const { board, workspaceId, labels, createLabel } = useBoardContext();
  const { data: members = [] } = useWorkspaceMembers(workspaceId);

  // Find the default column (prefer "todo" status, then first non-system column)
  const defaultColumn =
    board.columns.find((col) => col.status === "todo") ||
    board.columns.find((col) => !col.isSystem) ||
    board.columns[0];

  const defaultColumnId = providedDefaultColumnId ?? defaultColumn?.id ?? "";

  // Form state
  const [formState, setFormState] = useState<IssueFormState>(() =>
    getInitialFormState(defaultColumnId)
  );

  // Suggested subtasks
  const [suggestedSubtasks, setSuggestedSubtasks] = useState<SuggestedSubtask[]>(
    []
  );

  // Highlighting
  const [highlightedFields, setHighlightedFields] = useState<
    Set<keyof IssueFormState>
  >(new Set());
  const [highlightSubtasks, setHighlightSubtasks] = useState(false);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form update handler
  const updateForm = useCallback((updates: Partial<IssueFormState>) => {
    setFormState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Reset form
  const resetForm = useCallback(() => {
    setFormState(getInitialFormState(defaultColumnId));
    setSuggestedSubtasks([]);
    setHighlightedFields(new Set());
    setHighlightSubtasks(false);
  }, [defaultColumnId]);

  // Subtask handlers
  const addSuggestedSubtasks = useCallback(
    (subtasks: Omit<SuggestedSubtask, "id">[]) => {
      const newSubtasks = subtasks.map((s) => ({
        ...s,
        id: crypto.randomUUID(),
      }));
      setSuggestedSubtasks((prev) => [...prev, ...newSubtasks]);

      // Highlight subtasks section
      setHighlightSubtasks(true);
      setTimeout(() => setHighlightSubtasks(false), 2000);
    },
    []
  );

  const updateSuggestedSubtask = useCallback(
    (id: string, updates: Partial<Omit<SuggestedSubtask, "id">>) => {
      setSuggestedSubtasks((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
      );
    },
    []
  );

  const removeSuggestedSubtask = useCallback((id: string) => {
    setSuggestedSubtasks((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clearSuggestedSubtasks = useCallback(() => {
    setSuggestedSubtasks([]);
  }, []);

  // Highlight handler with auto-clear
  const highlightFields = useCallback((fields: (keyof IssueFormState)[]) => {
    setHighlightedFields(new Set(fields));
    setTimeout(() => setHighlightedFields(new Set()), 2000);
  }, []);

  // Can submit check
  const canSubmit = formState.title.trim().length > 0 && !isSubmitting;

  const value = useMemo<IssueFormContextValue>(
    () => ({
      formState,
      updateForm,
      resetForm,
      suggestedSubtasks,
      addSuggestedSubtasks,
      updateSuggestedSubtask,
      removeSuggestedSubtask,
      clearSuggestedSubtasks,
      highlightedFields,
      highlightFields,
      highlightSubtasks,
      setHighlightSubtasks,
      columns: board.columns,
      labels,
      members,
      onCreateLabel: createLabel,
      isSubmitting,
      setIsSubmitting,
      canSubmit,
    }),
    [
      formState,
      updateForm,
      resetForm,
      suggestedSubtasks,
      addSuggestedSubtasks,
      updateSuggestedSubtask,
      removeSuggestedSubtask,
      clearSuggestedSubtasks,
      highlightedFields,
      highlightFields,
      highlightSubtasks,
      board.columns,
      labels,
      members,
      createLabel,
      isSubmitting,
      canSubmit,
    ]
  );

  return (
    <IssueFormContext.Provider value={value}>
      {children}
    </IssueFormContext.Provider>
  );
}
