"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useWorkspaceChats, useCreateChat, useDeleteChat } from "@/lib/hooks";
import { getWorkspaceBySlug } from "@/lib/actions/workspace";
import { getChatAttachment } from "@/lib/actions/workspace-chat";
import { getSoul } from "@/lib/actions/soul";
import type { Workspace, WorkspaceChat, WorkspaceChatAttachment, WorkspaceSoul } from "@/lib/types";
import type { WorkspacePurpose } from "@/lib/design-tokens";

interface ChatContextValue {
  // Workspace
  workspace: Workspace | null;
  workspacePurpose: WorkspacePurpose;
  soul: WorkspaceSoul | null;
  isLoading: boolean;

  // Chats
  chats: WorkspaceChat[];
  isLoadingChats: boolean;
  selectedChatId: string | null;
  selectChat: (chatId: string) => void;
  createNewChat: () => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;

  // Attachment preview
  selectedAttachment: WorkspaceChatAttachment | null;
  isLoadingAttachment: boolean;
  viewAttachment: (attachmentId: string) => Promise<void>;
  closeAttachment: () => void;
  isPreviewOpen: boolean;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}

interface ChatProviderProps {
  children: ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatIdFromUrl = searchParams.get("chat");
  const attachmentIdFromUrl = searchParams.get("attachment");

  // Workspace state
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [soul, setSoul] = useState<WorkspaceSoul | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Chat selection state
  const [selectedChatId, setSelectedChatId] = useState<string | null>(chatIdFromUrl);

  // Attachment preview state
  const [selectedAttachment, setSelectedAttachment] = useState<WorkspaceChatAttachment | null>(null);
  const [isLoadingAttachment, setIsLoadingAttachment] = useState(false);
  const hasLoadedAttachmentFromUrl = useRef(false);

  // Load workspace data and soul on mount
  useEffect(() => {
    if (!params.slug) return;

    let cancelled = false;
    setIsLoading(true);

    getWorkspaceBySlug(params.slug)
      .then(async (ws) => {
        if (cancelled) return;
        if (ws) {
          setWorkspace(ws);
          // Load soul configuration
          const workspaceSoul = await getSoul(ws.id);
          if (!cancelled) {
            setSoul(workspaceSoul);
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [params.slug]);

  // Fetch chats
  const { data: chats = [], isLoading: isLoadingChats } = useWorkspaceChats(workspace?.id ?? null);
  const createChatMutation = useCreateChat(workspace?.id ?? "");
  const deleteChatMutation = useDeleteChat(workspace?.id ?? "");

  // URL update helper
  const updateUrl = useCallback(
    (chatId: string | null, attachmentId: string | null = null) => {
      const newParams = new URLSearchParams();
      if (chatId) newParams.set("chat", chatId);
      if (attachmentId) newParams.set("attachment", attachmentId);

      const queryString = newParams.toString();
      const url = `/w/${params.slug}/chat${queryString ? `?${queryString}` : ""}`;
      router.replace(url, { scroll: false });
    },
    [router, params.slug]
  );

  // Validate selected chat exists, auto-select first if needed
  useEffect(() => {
    if (isLoadingChats) return;

    if (chats.length === 0) {
      if (selectedChatId !== null) {
        setSelectedChatId(null);
      }
      return;
    }

    const chatExists = selectedChatId && chats.some((c) => c.id === selectedChatId);

    if (!chatExists) {
      const firstChatId = chats[0].id;
      setSelectedChatId(firstChatId);
      if (selectedChatId !== null && selectedChatId !== firstChatId) {
        setSelectedAttachment(null);
      }
      if (chatIdFromUrl !== firstChatId) {
        router.replace(`/w/${params.slug}/chat?chat=${firstChatId}`, { scroll: false });
      }
    }
  }, [chats, selectedChatId, chatIdFromUrl, router, params.slug, isLoadingChats]);

  // Load attachment from URL on mount
  useEffect(() => {
    if (hasLoadedAttachmentFromUrl.current || !attachmentIdFromUrl) return;
    hasLoadedAttachmentFromUrl.current = true;

    setIsLoadingAttachment(true);
    getChatAttachment(attachmentIdFromUrl)
      .then((attachment) => {
        if (attachment) {
          setSelectedAttachment(attachment);
        }
      })
      .catch((error) => {
        console.error("Failed to load attachment from URL:", error);
      })
      .finally(() => {
        setIsLoadingAttachment(false);
      });
  }, [attachmentIdFromUrl]);

  // Actions
  const selectChat = useCallback(
    (chatId: string) => {
      setSelectedChatId(chatId);
      setSelectedAttachment(null);
      updateUrl(chatId, null);
    },
    [updateUrl]
  );

  const createNewChat = useCallback(async () => {
    const newChat = await createChatMutation.mutateAsync(undefined);
    setSelectedChatId(newChat.id);
    setSelectedAttachment(null);
    updateUrl(newChat.id, null);
  }, [createChatMutation, updateUrl]);

  const deleteChat = useCallback(
    async (chatId: string) => {
      await deleteChatMutation.mutateAsync(chatId);
    },
    [deleteChatMutation]
  );

  const viewAttachment = useCallback(
    async (attachmentId: string) => {
      setIsLoadingAttachment(true);
      try {
        const attachment = await getChatAttachment(attachmentId);
        setSelectedAttachment(attachment);
        updateUrl(selectedChatId, attachmentId);
      } catch (error) {
        console.error("Failed to load attachment:", error);
      } finally {
        setIsLoadingAttachment(false);
      }
    },
    [selectedChatId, updateUrl]
  );

  const closeAttachment = useCallback(() => {
    setSelectedAttachment(null);
    updateUrl(selectedChatId, null);
  }, [selectedChatId, updateUrl]);

  // Computed values
  const validatedChatId =
    selectedChatId && chats.some((c) => c.id === selectedChatId) ? selectedChatId : null;

  const workspacePurpose: WorkspacePurpose =
    workspace?.purpose === "marketing" ? "marketing" : "software";

  const isPreviewOpen = !!(selectedAttachment || isLoadingAttachment);

  const value: ChatContextValue = {
    workspace,
    workspacePurpose,
    soul,
    isLoading,
    chats,
    isLoadingChats,
    selectedChatId: validatedChatId,
    selectChat,
    createNewChat,
    deleteChat,
    selectedAttachment,
    isLoadingAttachment,
    viewAttachment,
    closeAttachment,
    isPreviewOpen,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
