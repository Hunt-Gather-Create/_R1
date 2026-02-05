"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useParams } from "next/navigation";
import {
  useWorkspace,
  useWorkspaceMembers,
  useWorkspaceLabels,
  useWorkspaceColumns,
  useWorkspaceSkills,
  useWorkspaceMcpServers,
  useWorkspaceBrand,
  useWorkspaceMemories,
  useInvalidateSettings,
} from "@/lib/hooks";
import { getCurrentUserId } from "@/lib/auth";
import type {
  Workspace,
  WorkspaceMemberWithUser,
  WorkspaceRole,
  Label,
  Column,
  WorkspaceSkill,
  WorkspaceMemory,
} from "@/lib/types";
import type { McpServerWithStatus } from "@/lib/actions/integrations";
import type { BrandWithLogoUrl } from "@/lib/actions/brand";

interface SettingsContextValue {
  // Workspace data
  workspace: Workspace | null;
  members: WorkspaceMemberWithUser[];
  labels: Label[];
  columns: Column[];
  skills: WorkspaceSkill[];
  mcpServers: McpServerWithStatus[];
  brand: BrandWithLogoUrl | null;
  memories: WorkspaceMemory[];

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
  refreshSkills: () => Promise<void>;
  refreshMcpServers: () => Promise<void>;
  refreshBrand: () => Promise<void>;
  refreshMemories: () => Promise<void>;
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const invalidate = useInvalidateSettings();

  // TanStack Query hooks
  const {
    data: workspace,
    isLoading: isWorkspaceLoading,
    error: workspaceError,
    refetch: refetchWorkspace,
  } = useWorkspace(params.slug);

  const {
    data: members = [],
    isLoading: isMembersLoading,
    refetch: refetchMembers,
  } = useWorkspaceMembers(workspace?.id ?? null);

  const {
    data: labels = [],
    isLoading: isLabelsLoading,
    refetch: refetchLabels,
  } = useWorkspaceLabels(workspace?.id ?? null);

  const {
    data: columns = [],
    isLoading: isColumnsLoading,
    refetch: refetchColumns,
  } = useWorkspaceColumns(workspace?.id ?? null);

  const {
    data: skills = [],
    isLoading: isSkillsLoading,
    refetch: refetchSkills,
  } = useWorkspaceSkills(workspace?.id ?? null);

  const {
    data: mcpServers = [],
    isLoading: isMcpServersLoading,
    refetch: refetchMcpServers,
  } = useWorkspaceMcpServers(workspace?.id ?? null);

  const {
    data: brand,
    isLoading: isBrandLoading,
    refetch: refetchBrand,
  } = useWorkspaceBrand(workspace?.id ?? null);

  const {
    data: memories = [],
    isLoading: isMemoriesLoading,
    refetch: refetchMemories,
  } = useWorkspaceMemories(workspace?.id ?? null);

  // Load current user ID
  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);
  }, []);

  // Derive loading and error states
  const isLoading =
    isWorkspaceLoading ||
    isMembersLoading ||
    isLabelsLoading ||
    isColumnsLoading ||
    isSkillsLoading ||
    isMcpServersLoading ||
    isBrandLoading ||
    isMemoriesLoading;
  const error = workspaceError
    ? workspaceError instanceof Error
      ? workspaceError.message
      : "Failed to load workspace"
    : !workspace && !isWorkspaceLoading
      ? "Workspace not found"
      : null;

  // Derive permissions
  const currentMember = members.find((m) => m.userId === currentUserId);
  const userRole = (currentMember?.role as WorkspaceRole) ?? null;
  const isAdmin = userRole === "admin";
  const isOwner = workspace?.ownerId === currentUserId;

  // Refresh actions (for compatibility, now just trigger refetch)
  const refreshWorkspace = async () => {
    await refetchWorkspace();
  };

  const refreshMembers = async () => {
    if (workspace) {
      invalidate.invalidateMembers(workspace.id);
      await refetchMembers();
    }
  };

  const refreshLabels = async () => {
    if (workspace) {
      invalidate.invalidateLabels(workspace.id);
      await refetchLabels();
    }
  };

  const refreshColumns = async () => {
    if (workspace) {
      invalidate.invalidateColumns(workspace.id);
      await refetchColumns();
    }
  };

  const refreshSkills = async () => {
    if (workspace) {
      invalidate.invalidateSkills(workspace.id);
      await refetchSkills();
    }
  };

  const refreshMcpServers = async () => {
    if (workspace) {
      invalidate.invalidateMcpServers(workspace.id);
      await refetchMcpServers();
    }
  };

  const refreshBrand = async () => {
    if (workspace) {
      invalidate.invalidateBrand(workspace.id);
      await refetchBrand();
    }
  };

  const refreshMemories = async () => {
    if (workspace) {
      invalidate.invalidateMemories(workspace.id);
      await refetchMemories();
    }
  };

  const value: SettingsContextValue = {
    workspace: workspace ?? null,
    members,
    labels,
    columns,
    skills,
    mcpServers,
    brand: brand ?? null,
    memories,
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
    refreshSkills,
    refreshMcpServers,
    refreshBrand,
    refreshMemories,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
