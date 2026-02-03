"use client";

import type { ReactNode, RefObject } from "react";
import { Trash2 } from "lucide-react";
import type { UIMessage } from "@ai-sdk/react";
import { ChatMessageItem } from "./ChatMessageItem";
import { ChatLoadingIndicator } from "./ChatMessageBubble";
import { ChatSpacer } from "./ChatSpacer";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputAttachmentButton,
  PromptInputFilePreviews,
  PromptInputActions,
} from "./prompt-input";

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface ChatHeaderConfig {
  /** Header title */
  title?: string;
  /** Header subtitle */
  subtitle?: string;
  /** Icon to display next to title */
  icon?: ReactNode;
  /** Whether to show the clear history button (when messages exist) */
  showClearButton?: boolean;
}

export interface ChatContainerProps {
  /** Messages to display */
  messages: UIMessage[];
  /** Container ref for scroll behavior */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Textarea ref for auto-focus */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Spacer height for scroll positioning */
  spacerHeight: number;
  /** Whether chat is loading */
  isLoading: boolean;
  /** Input text value */
  input: string;
  /** Set input text */
  onInputChange: (value: string) => void;
  /** Submit handler */
  onSubmit: () => void;
  /** Optional header configuration */
  header?: ChatHeaderConfig;
  /** Clear history handler (required if showClearButton is true) */
  onClearHistory?: () => void;
  /** Welcome message when no messages exist */
  welcomeMessage?: string | (() => ReactNode);
  /** Custom tool call renderer */
  renderToolCall?: (toolName: string, result: unknown, index: number, part: MessagePart) => ReactNode;
  /** Input placeholder */
  inputPlaceholder?: string;
  /** Whether to show attachment button */
  showAttachmentButton?: boolean;
  /** Attached files */
  files?: File[];
  /** Set attached files */
  onFilesChange?: (files: File[]) => void;
  /** Custom loading indicator component */
  LoadingIndicator?: () => ReactNode;
  /** Whether loading history (shows loading spinner instead of content) */
  isLoadingHistory?: boolean;
  /** Custom empty state (shown when no messages and no welcome message) */
  emptyState?: ReactNode;
}

/**
 * Reusable chat container component that provides:
 * - Standard layout (header, messages, input)
 * - Welcome message display when empty
 * - Loading indicator placement
 * - Flexible tool call rendering via render prop
 */
export function ChatContainer({
  messages,
  containerRef,
  textareaRef,
  spacerHeight,
  isLoading,
  input,
  onInputChange,
  onSubmit,
  header,
  onClearHistory,
  welcomeMessage,
  renderToolCall,
  inputPlaceholder = "Type a message...",
  showAttachmentButton = false,
  files = [],
  onFilesChange,
  LoadingIndicator = ChatLoadingIndicator,
  isLoadingHistory = false,
  emptyState,
}: ChatContainerProps) {
  // Build display messages with optional welcome message
  const displayMessages =
    messages.length === 0 && welcomeMessage
      ? [
          {
            id: "welcome",
            role: "assistant" as const,
            parts: [
              {
                type: "text" as const,
                text: typeof welcomeMessage === "string" ? welcomeMessage : "",
              },
            ],
          },
        ]
      : messages;

  // Show loading state if loading history
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
      {header && (
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {header.icon && (
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
                {header.icon}
              </div>
            )}
            <div>
              {header.title && <h3 className="text-sm font-medium">{header.title}</h3>}
              {header.subtitle && (
                <p className="text-xs text-muted-foreground">{header.subtitle}</p>
              )}
            </div>
          </div>
          {header.showClearButton && messages.length > 0 && onClearHistory && (
            <button
              onClick={onClearHistory}
              className="p-0 rounded text-muted-foreground hover:text-red-500 cursor-pointer"
              title="Clear chat history"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {/* Empty state when no messages and no welcome message */}
        {messages.length === 0 && !welcomeMessage && emptyState}

        {/* Custom welcome message renderer */}
        {messages.length === 0 &&
          welcomeMessage &&
          typeof welcomeMessage === "function" &&
          welcomeMessage()}

        {/* Standard messages */}
        {displayMessages.map((message) => (
          <div key={message.id} data-message-role={message.role}>
            <ChatMessageItem
              message={message}
              renderToolCall={
                renderToolCall
                  ? (part, index) => {
                      // Extract tool name from type (e.g., "tool-fetchUrl" -> "fetchUrl")
                      const toolName = part.type?.replace("tool-", "") || "";
                      const toolPart = part as MessagePart & { output?: unknown };
                      return renderToolCall(toolName, toolPart.output, index, part);
                    }
                  : undefined
              }
            />
          </div>
        ))}

        {isLoading && <LoadingIndicator />}
        <ChatSpacer height={spacerHeight} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border shrink-0">
        <PromptInput
          value={input}
          onValueChange={onInputChange}
          files={files}
          onFilesChange={onFilesChange}
          isLoading={isLoading}
          onSubmit={onSubmit}
        >
          {showAttachmentButton && <PromptInputFilePreviews />}
          <PromptInputTextarea ref={textareaRef} placeholder={inputPlaceholder} rows={1} />
          <PromptInputActions>
            {showAttachmentButton && <PromptInputAttachmentButton />}
            <PromptInputSubmit />
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}
