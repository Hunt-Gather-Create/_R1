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
import { getCurrentUserId } from "@/lib/auth";
import type { Workspace, WorkspaceMemberWithUser, WorkspaceRole } from "@/lib/types";

interface SettingsContextValue {
  // Workspace data
  workspace: Workspace | null;
  members: WorkspaceMemberWithUser[];

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
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettingsContext must be used within a SettingsProvider");
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

        const wsMembers = await getWorkspaceMembers(ws.id);
        setMembers(wsMembers);
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
    isLoading,
    error,
    currentUserId,
    userRole,
    isAdmin,
    isOwner,
    refreshWorkspace,
    refreshMembers,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
