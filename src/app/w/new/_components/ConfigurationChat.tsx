"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, User } from "lucide-react";
import { MarkdownContent } from "@/components/ai-elements/MarkdownContent";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputActions,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import { ChatSpacer } from "@/components/ai-elements/ChatSpacer";
import { useAutoFocusOnComplete, useChatAutoScroll } from "@/lib/hooks";
import type { Status } from "@/lib/design-tokens";

export interface WorkspaceColumn {
  id: string;
  name: string;
  status: Status | null;
}

export interface WorkspaceLabel {
  name: string;
  color: string;
}

export interface SuggestedIssue {
  id: string;
  title: string;
  description: string;
}

interface ConfigurationChatProps {
  columns: WorkspaceColumn[];
  labels: WorkspaceLabel[];
  issues: SuggestedIssue[];
  onColumnsChange: (columns: WorkspaceColumn[]) => void;
  onLabelsChange: (labels: WorkspaceLabel[]) => void;
  onIssuesChange: (issues: SuggestedIssue[]) => void;
}

interface ToolOutput {
  success: boolean;
  action: string;
  columns?: Array<{ name: string; status: Status | null }>;
  labels?: Array<{ name: string; color: string }>;
  column?: { name: string; status: Status | null };
  position?: number;
  index?: number;
  updates?: { name?: string; status?: Status | null; title?: string; description?: string };
  issues?: Array<{ title: string; description?: string }>;
  issue?: { title: string; description?: string };
}

export function ConfigurationChat({
  columns,
  labels,
  issues,
  onColumnsChange,
  onLabelsChange,
  onIssuesChange,
}: ConfigurationChatProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const processedToolCallsRef = useRef<Set<string>>(new Set());
  const [input, setInput] = useState("");

  const transport = new DefaultChatTransport({
    api: "/api/workspace/configure",
    body: {
      currentConfig: {
        columns: columns.map((c) => ({ name: c.name, status: c.status })),
        labels,
        issues: issues.map((i) => ({ title: i.title, description: i.description })),
      },
    },
  });

  const { messages, sendMessage, status } = useChat({
    transport,
  });

  // Display messages with welcome message if empty
  const displayMessages =
    messages.length === 0
      ? [
          {
            id: "welcome",
            role: "assistant" as const,
            parts: [
              {
                type: "text" as const,
                text: "Hi! I'll help you set up your custom workspace. What will you be using this workspace for? Tell me about your workflow or project.",
              },
            ],
          },
        ]
      : messages;

  // Process tool calls to update configuration
  const processToolCalls = useCallback(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;

      for (const part of message.parts) {
        const partType = part.type as string;
        if (!partType.startsWith("tool-")) continue;

        const toolPart = part as unknown as {
          toolCallId: string;
          state: string;
          output?: ToolOutput;
        };

        if (toolPart.state !== "output-available" || !toolPart.output) continue;
        if (processedToolCallsRef.current.has(toolPart.toolCallId)) continue;

        processedToolCallsRef.current.add(toolPart.toolCallId);
        const output = toolPart.output;

        switch (output.action) {
          case "setColumns":
            if (output.columns) {
              onColumnsChange(
                output.columns.map((c) => ({
                  id: crypto.randomUUID(),
                  name: c.name,
                  status: c.status,
                }))
              );
            }
            break;

          case "addColumn":
            if (output.column) {
              const newColumn = {
                id: crypto.randomUUID(),
                name: output.column.name,
                status: output.column.status,
              };
              const pos = output.position ?? columns.length;
              const newColumns = [...columns];
              newColumns.splice(pos, 0, newColumn);
              onColumnsChange(newColumns);
            }
            break;

          case "removeColumn":
            if (typeof output.index === "number" && columns.length > 2) {
              const newColumns = columns.filter((_, i) => i !== output.index);
              onColumnsChange(newColumns);
            }
            break;

          case "updateColumn":
            if (typeof output.index === "number" && output.updates) {
              const newColumns = columns.map((col, i) => {
                if (i !== output.index) return col;
                return {
                  ...col,
                  name: output.updates?.name ?? col.name,
                  status:
                    output.updates?.status !== undefined
                      ? output.updates.status
                      : col.status,
                };
              });
              onColumnsChange(newColumns);
            }
            break;

          case "setLabels":
            if (output.labels) {
              onLabelsChange(output.labels);
            }
            break;

          case "suggestIssues":
            if (output.issues) {
              onIssuesChange(
                output.issues.map((i) => ({
                  id: crypto.randomUUID(),
                  title: i.title,
                  description: i.description || "",
                }))
              );
            }
            break;

          case "addIssue":
            if (output.issue) {
              const newIssue = {
                id: crypto.randomUUID(),
                title: output.issue.title,
                description: output.issue.description || "",
              };
              onIssuesChange([...issues, newIssue]);
            }
            break;

          case "removeIssue":
            if (typeof output.index === "number") {
              const newIssues = issues.filter((_, i) => i !== output.index);
              onIssuesChange(newIssues);
            }
            break;

          case "updateIssue":
            if (typeof output.index === "number" && output.updates) {
              const newIssues = issues.map((issue, i) => {
                if (i !== output.index) return issue;
                return {
                  ...issue,
                  title: output.updates?.title ?? issue.title,
                  description: output.updates?.description ?? issue.description,
                };
              });
              onIssuesChange(newIssues);
            }
            break;
        }
      }
    }
  }, [messages, columns, issues, onColumnsChange, onLabelsChange, onIssuesChange]);

  useEffect(() => {
    processToolCalls();
  }, [processToolCalls]);

  const isLoading = status === "streaming" || status === "submitted";

  // Scroll to bottom on load, scroll user's message to top when they submit
  const { spacerHeight } = useChatAutoScroll(containerRef, messages.length, status);

  // Auto-focus input when AI finishes responding
  useAutoFocusOnComplete(isLoading, textareaRef);

  const handleSubmit = () => {
    if (input.trim()) {
      sendMessage({ text: input });
      setInput("");
    }
  };

  return (
    <div className="flex flex-col h-full">
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
          isLoading={isLoading}
          onSubmit={handleSubmit}
        >
          <PromptInputTextarea
            ref={textareaRef}
            placeholder="Describe your workflow..."
            rows={1}
          />
          <PromptInputActions>
            <PromptInputSubmit />
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}

interface ChatMessageProps {
  message: {
    id: string;
    role: string;
    parts: Array<{ type: string; text?: string }>;
  };
}

function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  // Extract text content, filtering out tool calls
  const textParts = message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("\n");

  if (!textParts) return null;

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex items-center justify-center w-7 h-7 rounded-full shrink-0",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div
        className={cn(
          "flex flex-col gap-1 max-w-[85%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm overflow-hidden break-words",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}
        >
          <MarkdownContent content={textParts} />
        </div>
      </div>
    </div>
  );
}

function LoadingMessage() {
  return (
    <div className="flex gap-3">
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted shrink-0">
        <Bot className="w-4 h-4" />
      </div>
      <div className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted">
        <span className="w-2 h-2 rounded-full bg-foreground/30 animate-bounce" />
        <span
          className="w-2 h-2 rounded-full bg-foreground/30 animate-bounce"
          style={{ animationDelay: "0.1s" }}
        />
        <span
          className="w-2 h-2 rounded-full bg-foreground/30 animate-bounce"
          style={{ animationDelay: "0.2s" }}
        />
      </div>
    </div>
  );
}
