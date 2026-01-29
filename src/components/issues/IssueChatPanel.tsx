"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Sparkles, Trash2, Paperclip } from "lucide-react";
import { ChatLoadingIndicator } from "@/components/ai-elements/ChatMessageBubble";
import { ChatMessageItem } from "@/components/ai-elements/ChatMessageItem";
import { ChatSpacer } from "@/components/ai-elements/ChatSpacer";
import { ToolResultDisplay } from "@/components/ai-elements/ToolResultDisplay";
import { prepareFilesForSubmission } from "@/lib/chat/file-utils";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputAttachmentButton,
  PromptInputFilePreviews,
  PromptInputActions,
} from "@/components/ai-elements/prompt-input";
import {
  useIssueChatMessages,
  useSaveChatMessage,
  useClearChatMessages,
  useInvalidateAttachments,
  useAutoFocusOnComplete,
  useChatAutoScroll,
} from "@/lib/hooks";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import type { IssueWithLabels, Comment, ChatMessage } from "@/lib/types";

interface IssueContext {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  comments: Array<{ body: string }>;
}

interface IssueChatPanelProps {
  issue: IssueWithLabels;
  comments: Comment[];
  onUpdateDescription: (description: string) => void;
}

// Convert persisted messages to UI message format
function persistedToUIMessages(persisted: ChatMessage[]): UIMessage[] {
  return persisted.map((msg) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant",
    parts: [{ type: "text" as const, text: msg.content }],
  }));
}

export function IssueChatPanel({
  issue,
  comments,
  onUpdateDescription,
}: IssueChatPanelProps) {
  const { workspaceId, workspacePurpose } = useBoardContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const lastSavedMessageRef = useRef<string | null>(null);
  const hasInitializedRef = useRef(false);

  // Use TanStack Query for chat messages - auto-cancels on unmount
  const { data: persistedMessages, isLoading: isLoadingHistory } =
    useIssueChatMessages(issue.id);
  const saveChatMutation = useSaveChatMessage(issue.id);
  const clearChatMutation = useClearChatMessages(issue.id);
  const invalidateAttachments = useInvalidateAttachments(issue.id);

  // Build issue context for the API
  const issueContext: IssueContext = useMemo(
    () => ({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      comments: comments.map((c) => ({ body: c.body })),
    }),
    [issue.id, issue.title, issue.description, issue.status, issue.priority, comments]
  );

  // Custom transport that includes issue context, workspace ID and purpose
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/issue",
        body: { issueContext, workspaceId, workspacePurpose },
      }),
    [issueContext, workspaceId, workspacePurpose]
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName === "updateDescription") {
        const args = toolCall.input as { description: string };
        onUpdateDescription(args.description);
      }
      if (toolCall.toolName === "attachContent") {
        // Refresh attachments after AI attaches content
        // Small delay to ensure server-side processing is complete
        setTimeout(() => invalidateAttachments(), 500);
      }
    },
  });

  // Initialize chat messages from query data
  useEffect(() => {
    if (hasInitializedRef.current || !persistedMessages) return;

    if (persistedMessages.length > 0) {
      setMessages(persistedToUIMessages(persistedMessages));
      // Mark the last persisted message as already saved
      lastSavedMessageRef.current =
        persistedMessages[persistedMessages.length - 1].id;
    }
    hasInitializedRef.current = true;
  }, [persistedMessages, setMessages]);

  // Save new messages as they come in
  useEffect(() => {
    if (messages.length === 0 || isLoadingHistory) return;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.id === lastSavedMessageRef.current) return;

    // Only save completed messages (not streaming)
    if (status === "streaming" && lastMessage.role === "assistant") return;

    // Extract text content from parts
    const textContent = lastMessage.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");

    if (textContent) {
      // Use mutation to save and update cache
      saveChatMutation.mutate({ role: lastMessage.role, content: textContent });
      lastSavedMessageRef.current = lastMessage.id;
    }
  }, [messages, status, isLoadingHistory, saveChatMutation]);

  // Handle clearing chat history
  const handleClearHistory = useCallback(async () => {
    await clearChatMutation.mutateAsync();
    setMessages([]);
    lastSavedMessageRef.current = null;
    hasInitializedRef.current = false;
  }, [clearChatMutation, setMessages]);

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
                text: `I'm here to help you refine **${issue.title}**. I can see the current description, status, and any comments.\n\nHow can I help? For example:\n- "Add acceptance criteria"\n- "Suggest improvements to the description"\n- "Break this down into smaller tasks"`,
              },
            ],
          },
        ]
      : messages;

  const isLoading = status === "streaming" || status === "submitted";

  // Scroll to bottom on load, scroll user's message to top when they submit
  const { spacerHeight } = useChatAutoScroll(containerRef, messages.length, status);

  // Auto-focus input when AI finishes responding
  useAutoFocusOnComplete(isLoading, textareaRef);

  const handleSubmit = async () => {
    if (input.trim() || files.length > 0) {
      const { messageText, fileAttachments } = await prepareFilesForSubmission(files, input);

      sendMessage({
        text: messageText,
        files: fileAttachments.length > 0 ? fileAttachments : undefined,
      });
      setInput("");
      setFiles([]);
    }
  };

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
        <h3 className="text-sm font-medium">AI Assistant</h3>
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
            <ChatMessageItem
              message={message}
              renderToolCall={(part, index) => {
                const toolPart = part as { toolName?: string; result?: unknown };
                // Handle custom tool (updateDescription)
                if (toolPart.toolName === "updateDescription") {
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Description updated</span>
                    </div>
                  );
                }
                // Handle attachContent tool
                if (toolPart.toolName === "attachContent") {
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50"
                    >
                      <Paperclip className="w-3 h-3" />
                      <span>Content attached to issue</span>
                    </div>
                  );
                }
                // Handle built-in tools
                if (toolPart.toolName) {
                  return (
                    <ToolResultDisplay
                      key={index}
                      toolName={toolPart.toolName}
                      result={toolPart.result}
                    />
                  );
                }
                return null;
              }}
            />
          </div>
        ))}
        {isLoading && <ChatLoadingIndicator />}
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
          <PromptInputTextarea
            ref={textareaRef}
            placeholder="Ask to refine requirements, add acceptance criteria..."
            rows={1}
          />
          <PromptInputActions>
            <PromptInputAttachmentButton />
            <PromptInputSubmit />
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}
