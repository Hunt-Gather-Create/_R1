"use client";

import { useRef, useState, useMemo, useCallback, useEffect, type RefObject } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { prepareFilesForSubmission } from "@/lib/chat/file-utils";
import { useAutoFocusOnComplete } from "./use-auto-focus";
import { useChatAutoScroll } from "./use-chat-auto-scroll";

type ChatStatus = "ready" | "submitted" | "streaming" | "error";

interface ToolCallInfo {
  toolName: string;
  toolCallId: string;
  input: unknown;
}

interface PersistenceConfig<TPersistedMessage> {
  /** Entity ID for persistence (e.g., issue ID, chat ID) */
  entityId: string;
  /** Hook that returns persisted messages and loading state */
  useMessages: (id: string) => { data?: TPersistedMessage[]; isLoading: boolean };
  /** Convert persisted messages to UI message format */
  toUIMessages: (persisted: TPersistedMessage[]) => UIMessage[];
  /** Callback to save a new message */
  onSaveMessage?: (message: UIMessage, status: ChatStatus) => void;
  /** Callback to clear all messages */
  onClearMessages?: () => Promise<void>;
}

export interface UseChatCoreOptions<TPersistedMessage = unknown> {
  /** API endpoint for chat */
  api: string;
  /** Additional body to send with each request */
  transportBody?: Record<string, unknown>;
  /** Called when a tool is invoked */
  onToolCall?: (info: { toolCall: ToolCallInfo }) => void;
  /** Optional persistence configuration */
  persistence?: PersistenceConfig<TPersistedMessage>;
}

export interface UseChatCoreReturn {
  /** Chat messages (UI messages) */
  messages: UIMessage[];
  /** Set messages directly (for persistence integration) */
  setMessages: (messages: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => void;
  /** Send a message */
  sendMessage: (params: {
    text: string;
    files?: Array<{ type: "file"; filename: string; mediaType: string; url: string }>;
  }) => void;
  /** Current chat status */
  status: ChatStatus;
  /** Whether chat is loading (streaming or submitted) */
  isLoading: boolean;
  /** Whether persistence is loading history */
  isLoadingHistory: boolean;
  /** Submit handler that handles files and clears input */
  handleSubmit: () => Promise<void>;
  /** Clear chat history */
  handleClearHistory: () => Promise<void>;
  /** Input text value */
  input: string;
  /** Set input text */
  setInput: (value: string) => void;
  /** Attached files */
  files: File[];
  /** Set attached files */
  setFiles: (files: File[]) => void;
  /** Container ref for scroll behavior */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Textarea ref for auto-focus */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Spacer height for scroll positioning */
  spacerHeight: number;
}

/**
 * Core hook for chat functionality. Encapsulates:
 * - DefaultChatTransport creation with memoization
 * - useChat from @ai-sdk/react
 * - Loading state handling
 * - File submission preparation
 * - Auto-scroll and auto-focus behavior
 * - Optional persistence integration
 */
export function useChatCore<TPersistedMessage = unknown>(
  options: UseChatCoreOptions<TPersistedMessage>
): UseChatCoreReturn {
  const { api, transportBody, onToolCall, persistence } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const lastSavedMessageRef = useRef<string | null>(null);
  const hasInitializedRef = useRef(false);

  // Persistence hooks - called unconditionally
  const persistedData = persistence?.useMessages(persistence.entityId);
  const persistedMessages = persistedData?.data;
  const isLoadingHistory = persistedData?.isLoading ?? false;

  // Memoize transport to prevent unnecessary re-renders
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api,
        body: transportBody,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, JSON.stringify(transportBody)]
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
    onToolCall: onToolCall
      ? ({ toolCall }) => {
          onToolCall({
            toolCall: {
              toolName: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              input: toolCall.input,
            },
          });
        }
      : undefined,
  });

  // Initialize chat messages from persisted data
  useEffect(() => {
    if (!persistence || hasInitializedRef.current || !persistedMessages) return;

    if (persistedMessages.length > 0) {
      const uiMessages = persistence.toUIMessages(persistedMessages);
      setMessages(uiMessages);
      // Mark the last persisted message as already saved
      lastSavedMessageRef.current = uiMessages[uiMessages.length - 1]?.id ?? null;
    }
    hasInitializedRef.current = true;
  }, [persistence, persistedMessages, setMessages]);

  // Save new messages as they come in (when persistence is configured)
  useEffect(() => {
    if (!persistence?.onSaveMessage || messages.length === 0 || isLoadingHistory) return;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.id === lastSavedMessageRef.current) return;

    // Only save completed messages (not streaming)
    if (status === "streaming" && lastMessage.role === "assistant") return;

    persistence.onSaveMessage(lastMessage, status);
    lastSavedMessageRef.current = lastMessage.id;
  }, [messages, status, isLoadingHistory, persistence]);

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll behavior
  const { spacerHeight } = useChatAutoScroll(containerRef, messages.length, status);

  // Auto-focus when AI finishes responding
  useAutoFocusOnComplete(isLoading, textareaRef);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() && files.length === 0) return;

    const { messageText, fileAttachments } = await prepareFilesForSubmission(files, input);

    sendMessage({
      text: messageText,
      files: fileAttachments.length > 0 ? fileAttachments : undefined,
    });
    setInput("");
    setFiles([]);
  }, [input, files, sendMessage]);

  const handleClearHistory = useCallback(async () => {
    if (persistence?.onClearMessages) {
      await persistence.onClearMessages();
    }
    setMessages([]);
    lastSavedMessageRef.current = null;
    hasInitializedRef.current = false;
  }, [persistence, setMessages]);

  return {
    messages,
    setMessages,
    sendMessage,
    status,
    isLoading,
    isLoadingHistory,
    handleSubmit,
    handleClearHistory,
    input,
    setInput,
    files,
    setFiles,
    containerRef,
    textareaRef,
    spacerHeight,
  };
}
