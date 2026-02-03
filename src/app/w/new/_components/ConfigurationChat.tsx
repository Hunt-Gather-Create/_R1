"use client";

import { useRef, useCallback, useEffect } from "react";
import { useChatCore } from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";
import { ChatLoadingIndicator } from "@/components/ai-elements/ChatMessageBubble";
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
  const processedToolCallsRef = useRef<Set<string>>(new Set());

  const chat = useChatCore({
    api: "/api/workspace/configure",
    transportBody: {
      currentConfig: {
        columns: columns.map((c) => ({ name: c.name, status: c.status })),
        labels,
        issues: issues.map((i) => ({ title: i.title, description: i.description })),
      },
    },
  });

  // Process tool calls to update configuration
  const processToolCalls = useCallback(() => {
    for (const message of chat.messages) {
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
  }, [chat.messages, columns, issues, onColumnsChange, onLabelsChange, onIssuesChange]);

  useEffect(() => {
    processToolCalls();
  }, [processToolCalls]);

  return (
    <ChatContainer
      messages={chat.messages}
      containerRef={chat.containerRef}
      textareaRef={chat.textareaRef}
      spacerHeight={chat.spacerHeight}
      isLoading={chat.isLoading}
      input={chat.input}
      onInputChange={chat.setInput}
      onSubmit={chat.handleSubmit}
      welcomeMessage="Hi! I'll help you set up your custom workspace. What will you be using this workspace for? Tell me about your workflow or project."
      inputPlaceholder="Describe your workflow..."
      LoadingIndicator={ChatLoadingIndicator}
    />
  );
}
