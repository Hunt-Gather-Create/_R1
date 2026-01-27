"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  getWorkspaceBySlug,
  getWorkspaceMembers,
} from "@/lib/actions/workspace";
import { getWorkspaceLabels } from "@/lib/actions/board";
import { getAllWorkspaceColumns } from "@/lib/actions/columns";
import { getWorkspaceSkills } from "@/lib/actions/skills";
import { getWorkspaceMcpServers } from "@/lib/actions/integrations";

export function useWorkspace(slug: string) {
  return useQuery({
    queryKey: [...queryKeys.workspace.all, "slug", slug],
    queryFn: () => getWorkspaceBySlug(slug),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useWorkspaceMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.workspace.members(workspaceId ?? ""),
    queryFn: () => getWorkspaceMembers(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useWorkspaceLabels(workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.settings.labels(workspaceId ?? ""),
    queryFn: () => getWorkspaceLabels(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useWorkspaceColumns(workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.settings.columns(workspaceId ?? ""),
    queryFn: () => getAllWorkspaceColumns(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useWorkspaceSkills(workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.settings.skills(workspaceId ?? ""),
    queryFn: () => getWorkspaceSkills(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useWorkspaceMcpServers(workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.settings.mcpServers(workspaceId ?? ""),
    queryFn: () => getWorkspaceMcpServers(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

// Hook for invalidating settings queries
export function useInvalidateSettings() {
  const queryClient = useQueryClient();

  return {
    invalidateLabels: (workspaceId: string) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.labels(workspaceId),
      }),
    invalidateColumns: (workspaceId: string) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.columns(workspaceId),
      }),
    invalidateMembers: (workspaceId: string) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workspace.members(workspaceId),
      }),
    invalidateSkills: (workspaceId: string) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.skills(workspaceId),
      }),
    invalidateMcpServers: (workspaceId: string) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.mcpServers(workspaceId),
      }),
  };
}
