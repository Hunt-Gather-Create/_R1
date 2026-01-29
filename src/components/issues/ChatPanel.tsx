"use client";

import { useRef, useState, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Sparkles } from "lucide-react";
import { ChatLoadingIndicator } from "@/components/ai-elements/ChatMessageBubble";
import { ChatMessageItem } from "@/components/ai-elements/ChatMessageItem";
import { ChatSpacer } from "@/components/ai-elements/ChatSpacer";
import { prepareFilesForSubmission } from "@/lib/chat/file-utils";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputAttachmentButton,
  PromptInputFilePreviews,
  PromptInputActions,
} from "@/components/ai-elements/prompt-input";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { useAutoFocusOnComplete, useChatAutoScroll } from "@/lib/hooks";
import type { Priority } from "@/lib/design-tokens";

interface SuggestedIssue {
  title: string;
  description: string;
  priority: Priority;
}

interface ChatPanelProps {
  onSuggestion: (suggestion: SuggestedIssue) => void;
}

export function ChatPanel({ onSuggestion }: ChatPanelProps) {
  const { workspaceId, workspacePurpose } = useBoardContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { workspaceId, workspacePurpose },
      }),
    [workspaceId, workspacePurpose]
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName === "suggestIssue") {
        const input = toolCall.input as SuggestedIssue;
        onSuggestion({
          title: input.title,
          description: input.description,
          priority: input.priority as Priority,
        });
      }
    },
  });

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
                text: "Hi! I'm here to help you craft a great user story. What would you like to build today?",
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b border-border shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-medium">AI Assistant</h3>
          <p className="text-xs text-muted-foreground">
            Helping you write better user stories
          </p>
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {displayMessages.map((message) => (
          <div key={message.id} data-message-role={message.role}>
            <ChatMessageItem
              message={message}
              renderToolCall={(part, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Form populated with suggestion</span>
                </div>
              )}
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
            placeholder="Describe what you'd like to build..."
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
