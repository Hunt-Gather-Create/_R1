"use client";

import { useEffect, useRef, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { useChatCore } from "@/lib/hooks";
import { ChatMessage, LoadingMessage } from "./ChatMessage";
import { ChatSpacer } from "@/components/ai-elements/ChatSpacer";
import { useChatContext } from "./ChatContext";
import { persistedToUIMessages } from "./chat-utils";
import { serializeMessageParts } from "@/lib/chat/message-persistence";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputAttachmentButton,
  PromptInputFilePreviews,
  PromptInputActions,
} from "@/components/ai-elements/prompt-input";
import {
  useChatMessages,
  useSaveWorkspaceChatMessage,
  useClearWorkspaceChatMessages,
  useUpdateChatTitle,
} from "@/lib/hooks";

export function ChatPanel() {
  const { selectedChatId, workspace, workspacePurpose, soul, viewAttachment } = useChatContext();

  const lastSavedMessageRef = useRef<string | null>(null);
  const hasInitializedRef = useRef(false);
  const hasGeneratedTitleRef = useRef(false);
  const openedAttachmentsRef = useRef<Set<string>>(new Set());

  const chatId = selectedChatId!;
  const workspaceId = workspace!.id;

  // Use TanStack Query for chat messages
  const { data: persistedMessages, isLoading: isLoadingHistory } = useChatMessages(chatId);
  const saveChatMutation = useSaveWorkspaceChatMessage(chatId);
  const clearChatMutation = useClearWorkspaceChatMessages(chatId);
  const updateTitleMutation = useUpdateChatTitle();

  const {
    messages,
    setMessages,
    status,
    isLoading,
    input,
    setInput,
    files,
    setFiles,
    containerRef,
    textareaRef,
    spacerHeight,
    handleSubmit,
  } = useChatCore({
    api: "/api/chat/workspace",
    transportBody: { workspaceId, workspacePurpose, chatId },
  });

  // Initialize chat messages from query data
  useEffect(() => {
    if (hasInitializedRef.current || !persistedMessages) return;

    if (persistedMessages.length > 0) {
      setMessages(persistedToUIMessages(persistedMessages));
      lastSavedMessageRef.current = persistedMessages[persistedMessages.length - 1].id;
      hasGeneratedTitleRef.current = true;
      // Mark existing attachments as already opened (don't auto-open on load)
      for (const msg of persistedMessages) {
        for (const attachment of msg.attachments) {
          openedAttachmentsRef.current.add(attachment.id);
        }
      }
    }
    hasInitializedRef.current = true;
  }, [persistedMessages, setMessages]);

  // Reset state when chatId changes
  useEffect(() => {
    hasInitializedRef.current = false;
    hasGeneratedTitleRef.current = false;
    lastSavedMessageRef.current = null;
    openedAttachmentsRef.current = new Set();
    setMessages([]);
  }, [chatId, setMessages]);

  // Save new messages as they come in
  useEffect(() => {
    if (messages.length === 0 || isLoadingHistory) return;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.id === lastSavedMessageRef.current) return;

    // Only save completed messages (not streaming)
    if (status === "streaming" && lastMessage.role === "assistant") return;

    // Extract attachment IDs for database linking
    const attachmentIds: string[] = [];
    for (const part of lastMessage.parts) {
      if (
        part.type?.startsWith("tool-createFile") &&
        (part as unknown as { state: string }).state === "output-available"
      ) {
        const output = (part as unknown as { output?: { attachmentId?: string } }).output;
        if (output?.attachmentId) {
          attachmentIds.push(output.attachmentId);
        }
      }
    }

    // Store full parts array as JSON to preserve tool calls
    const content = serializeMessageParts(lastMessage.parts);

    saveChatMutation.mutate({
      role: lastMessage.role,
      content,
      attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
    });
    lastSavedMessageRef.current = lastMessage.id;

    // Auto-generate title from first user message
    if (!hasGeneratedTitleRef.current && lastMessage.role === "user" && messages.length === 1) {
      const textContent = lastMessage.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ")
        .trim();
      const title = textContent.length > 50 ? textContent.substring(0, 50) + "..." : textContent;
      if (title) {
        updateTitleMutation.mutate({ chatId, title });
      }
      hasGeneratedTitleRef.current = true;
    }
  }, [messages, status, isLoadingHistory, saveChatMutation, chatId, updateTitleMutation]);

  // Auto-open attachment preview when AI creates a new file
  useEffect(() => {
    if (!hasInitializedRef.current) return;

    for (const message of messages) {
      if (message.role !== "assistant") continue;

      for (const part of message.parts) {
        if (
          part.type?.startsWith("tool-createFile") &&
          (part as unknown as { state: string }).state === "output-available"
        ) {
          const output = (part as unknown as { output?: { attachmentId?: string } }).output;
          if (output?.attachmentId && !openedAttachmentsRef.current.has(output.attachmentId)) {
            openedAttachmentsRef.current.add(output.attachmentId);
            viewAttachment(output.attachmentId);
          }
        }
      }
    }
  }, [messages, viewAttachment]);

  // Handle clearing chat history
  const handleClearHistory = useCallback(async () => {
    await clearChatMutation.mutateAsync();
    setMessages([]);
    lastSavedMessageRef.current = null;
  }, [clearChatMutation, setMessages]);

  // Build personalized welcome message based on soul configuration
  const getWelcomeMessage = () => {
    if (soul?.greeting) {
      return soul.greeting;
    }

    const name = soul?.name || "your workspace assistant";
    const intro = `Hi! I'm ${name}. I can help you with:\n\n`;
    const capabilities = `- **Research**: Search the web for information, documentation, and best practices\n- **Analysis**: Run calculations, analyze data, and generate code examples\n- **Planning**: Discuss strategies, brainstorm ideas, and solve problems`;
    const outro = `\n\nHow can I help you today?`;

    return intro + capabilities + outro;
  };

  // Add welcome message if no messages exist
  const displayMessages =
    messages.length === 0
      ? [
          {
            id: "welcome",
            role: "assistant" as const,
            parts: [
              {
                type: "text" as const,
                text: getWelcomeMessage(),
              },
            ],
          },
        ]
      : messages;

  if (isLoadingHistory) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground mt-2">Loading chat...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <h3 className="text-sm font-medium">{soul?.name || "AI Assistant"}</h3>
        {messages.length > 0 && (
          <button
            onClick={handleClearHistory}
            className="p-0 rounded text-muted-foreground hover:text-red-500 cursor-pointer"
            title="Clear chat history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {displayMessages.map((message) => (
          <div key={message.id} data-message-role={message.role}>
            <ChatMessage message={message} />
          </div>
        ))}
        {isLoading && <LoadingMessage />}
        <ChatSpacer height={spacerHeight} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border shrink-0">
        <PromptInput
          value={input}
          onValueChange={setInput}
          files={files}
          onFilesChange={setFiles}
          isLoading={isLoading}
          onSubmit={handleSubmit}
        >
          <PromptInputFilePreviews />
          <PromptInputTextarea ref={textareaRef} placeholder="Ask me anything..." rows={1} />
          <PromptInputActions>
            <PromptInputAttachmentButton />
            <PromptInputSubmit />
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}
