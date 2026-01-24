"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useParams } from "next/navigation";
import {
  getWorkspaceBySlug,
  getWorkspaceMembers,
} from "@/lib/actions/workspace";
import { getWorkspaceLabels } from "@/lib/actions/board";
import { getAllWorkspaceColumns } from "@/lib/actions/columns";
import { getCurrentUserId } from "@/lib/auth";
import type {
  Workspace,
  WorkspaceMemberWithUser,
  WorkspaceRole,
  Label,
  Column,
} from "@/lib/types";

interface SettingsContextValue {
  // Workspace data
  workspace: Workspace | null;
  members: WorkspaceMemberWithUser[];
  labels: Label[];
  columns: Column[];

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Current user info
  currentUserId: string | null;
  userRole: WorkspaceRole | null;
  isAdmin: boolean;
  isOwner: boolean;

  // Actions
  refreshWorkspace: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  refreshLabels: () => Promise<void>;
  refreshColumns: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error(
      "useSettingsContext must be used within a SettingsProvider"
    );
  }
  return context;
}

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const params = useParams<{ slug: string }>();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberWithUser[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkspace = useCallback(async () => {
    try {
      const ws = await getWorkspaceBySlug(params.slug);
      if (ws) {
        setWorkspace(ws);
      }
    } catch (err) {
      console.error("Failed to refresh workspace:", err);
    }
  }, [params.slug]);

  const refreshMembers = useCallback(async () => {
    if (!workspace) return;
    try {
      const wsMembers = await getWorkspaceMembers(workspace.id);
      setMembers(wsMembers);
    } catch (err) {
      console.error("Failed to refresh members:", err);
    }
  }, [workspace]);

  const refreshLabels = useCallback(async () => {
    if (!workspace) return;
    try {
      const wsLabels = await getWorkspaceLabels(workspace.id);
      setLabels(wsLabels);
    } catch (err) {
      console.error("Failed to refresh labels:", err);
    }
  }, [workspace]);

  const refreshColumns = useCallback(async () => {
    if (!workspace) return;
    try {
      const wsColumns = await getAllWorkspaceColumns(workspace.id);
      setColumns(wsColumns);
    } catch (err) {
      console.error("Failed to refresh columns:", err);
    }
  }, [workspace]);

  // Initial data load
  useEffect(() => {
    async function loadData() {
      try {
        const [userId, ws] = await Promise.all([
          getCurrentUserId(),
          getWorkspaceBySlug(params.slug),
        ]);

        setCurrentUserId(userId);

        if (!ws) {
          setError("Workspace not found");
          return;
        }

        setWorkspace(ws);

        const [wsMembers, wsLabels, wsColumns] = await Promise.all([
          getWorkspaceMembers(ws.id),
          getWorkspaceLabels(ws.id),
          getAllWorkspaceColumns(ws.id),
        ]);
        setMembers(wsMembers);
        setLabels(wsLabels);
        setColumns(wsColumns);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [params.slug]);

  // Derive permissions
  const currentMember = members.find((m) => m.userId === currentUserId);
  const userRole = (currentMember?.role as WorkspaceRole) ?? null;
  const isAdmin = userRole === "admin";
  const isOwner = workspace?.ownerId === currentUserId;

  const value: SettingsContextValue = {
    workspace,
    members,
    labels,
    columns,
    isLoading,
    error,
    currentUserId,
    userRole,
    isAdmin,
    isOwner,
    refreshWorkspace,
    refreshMembers,
    refreshLabels,
    refreshColumns,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
