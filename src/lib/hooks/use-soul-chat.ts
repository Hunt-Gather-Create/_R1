"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  getSoulChatMessages,
  saveSoulChatMessage,
  deleteSoulChatMessages,
  type SoulChatMessage,
} from "@/lib/actions/soul";

export function useSoulChatMessages(workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.soul.chat(workspaceId ?? ""),
    queryFn: () => getSoulChatMessages(workspaceId!),
    enabled: !!workspaceId,
    staleTime: Infinity, // Chat doesn't go stale - manual invalidation only
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useSaveSoulChatMessage(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (message: { id: string; role: "user" | "assistant"; content: string }) =>
      saveSoulChatMessage(workspaceId, message),
    onSuccess: (_, message) => {
      queryClient.setQueryData<SoulChatMessage[]>(
        queryKeys.soul.chat(workspaceId),
        (old) => {
          const newMessage: SoulChatMessage = {
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: new Date(),
          };
          return old ? [...old, newMessage] : [newMessage];
        }
      );
    },
  });
}

export function useClearSoulChatMessages(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteSoulChatMessages(workspaceId),
    onSuccess: () => {
      queryClient.setQueryData<SoulChatMessage[]>(
        queryKeys.soul.chat(workspaceId),
        []
      );
    },
  });
}
