"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, User, Sparkles } from "lucide-react";
import {
  CollapsibleFileContent,
  parseTextWithFileAttachments,
} from "@/components/ai-elements/CollapsibleFileContent";
import { ChatLoadingIndicator } from "@/components/ai-elements/ChatMessageBubble";
import { UserFileAttachment } from "@/components/ai-elements/UserFileAttachment";
import { prepareFilesForSubmission } from "@/lib/chat/file-utils";
import { ToolResultDisplay } from "@/components/ai-elements/ToolResultDisplay";
import { marked } from "marked";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputAttachmentButton,
  PromptInputFilePreviews,
  PromptInputActions,
} from "@/components/ai-elements/prompt-input";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import type { Priority } from "@/lib/design-tokens";

export interface PlannedIssue {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  status: "pending" | "creating" | "created";
}

interface PlanningChatPanelProps {
  onPlanIssue: (issue: Omit<PlannedIssue, "id" | "status">) => void;
}

export function PlanningChatPanel({ onPlanIssue }: PlanningChatPanelProps) {
  const { workspaceId, workspacePurpose } = useBoardContext();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const prevStatusRef = useRef<string | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/planning",
        body: { workspaceId, workspacePurpose },
      }),
    [workspaceId, workspacePurpose]
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName === "planIssue") {
        const args = toolCall.input as {
          title: string;
          description: string;
          priority: Priority;
        };
        onPlanIssue({
          title: args.title,
          description: args.description,
          priority: args.priority,
        });
      }
    },
  });

  const welcomeText =
    workspacePurpose === "marketing"
      ? `What campaign or project would you like to plan? Tell me about your goals and I'll help you break it down into actionable tasks.`
      : `What would you like to build? Tell me about your feature or project and I'll help you break it down into actionable issues.`;

  const displayMessages: UIMessage[] =
    messages.length === 0
      ? [
          {
            id: "welcome",
            role: "assistant" as const,
            parts: [
              {
                type: "text" as const,
                text: welcomeText,
              },
            ],
          },
        ]
      : messages;

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-focus input when AI finishes responding
  useEffect(() => {
    const wasLoading =
      prevStatusRef.current === "streaming" ||
      prevStatusRef.current === "submitted";
    const isNowReady = status === "ready";

    if (wasLoading && isNowReady) {
      inputRef.current?.focus();
    }

    prevStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <h3 className="text-sm font-medium">AI Planning Assistant</h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {displayMessages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex gap-3",
              message.role === "user" ? "flex-row-reverse" : "flex-row"
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-7 h-7 rounded-full shrink-0",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              {message.role === "user" ? (
                <User className="w-4 h-4" />
              ) : (
                <Bot className="w-4 h-4" />
              )}
            </div>
            <div
              className={cn(
                "flex flex-col gap-1 max-w-[85%]",
                message.role === "user" ? "items-end" : "items-start"
              )}
            >
              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                {message.parts.map((part, index) => {
                  if (part.type === "text") {
                    // Check if this is a user message with embedded file content
                    if (message.role === "user" && part.text.includes("\n\n--- ")) {
                      const { mainText, filesSections } = parseTextWithFileAttachments(part.text);
                      return (
                        <div key={index}>
                          {mainText && (
                            <div
                              className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2"
                              dangerouslySetInnerHTML={{
                                __html: marked.parse(mainText, { async: false }),
                              }}
                            />
                          )}
                          {filesSections.map((file, fileIndex) => (
                            <CollapsibleFileContent
                              key={`file-${fileIndex}`}
                              filename={file.filename}
                              content={file.content}
                            />
                          ))}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={index}
                        className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2"
                        dangerouslySetInnerHTML={{
                          __html: marked.parse(part.text, { async: false }),
                        }}
                      />
                    );
                  }
                  // Handle user-attached files
                  if (part.type === "file") {
                    const filePart = part as unknown as {
                      type: "file";
                      mediaType: string;
                      url: string;
                      filename?: string;
                    };
                    return <UserFileAttachment key={index} part={filePart} />;
                  }
                  if (part.type?.startsWith("tool-")) {
                    const toolPart = part as { toolName?: string; result?: unknown };
                    // Handle custom tool (planIssue)
                    if (toolPart.toolName === "planIssue") {
                      return (
                        <div
                          key={index}
                          className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Issue added to plan</span>
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
                  }
                  return null;
                })}
              </div>
            </div>
          </div>
        ))}
        {isLoading && <ChatLoadingIndicator />}
        <div ref={messagesEndRef} />
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
            ref={inputRef}
            placeholder="Describe what you want to build..."
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
