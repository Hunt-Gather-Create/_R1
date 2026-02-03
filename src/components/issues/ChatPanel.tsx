"use client";

import { Sparkles } from "lucide-react";
import { useChatCore } from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { useIssueFormContext, type IssueFormState } from "./context";
import type { Priority } from "@/lib/design-tokens";

interface SuggestedIssue {
  title: string;
  description: string;
  priority: number;
}

interface SuggestedSubtaskInput {
  title: string;
  description?: string;
  priority?: number;
}

export function ChatPanel() {
  const { workspaceId, workspacePurpose } = useBoardContext();
  const {
    updateForm,
    highlightFields,
    suggestedSubtasks,
    addSuggestedSubtasks,
    clearSuggestedSubtasks,
  } = useIssueFormContext();

  // Prepare subtasks for AI context (titles only - AI manages by replacement, not by ID)
  const subtasksContext = suggestedSubtasks.map((s) => ({
    title: s.title,
    description: s.description,
    priority: s.priority,
  }));

  const chat = useChatCore({
    api: "/api/chat",
    transportBody: { workspaceId, workspacePurpose, suggestedSubtasks: subtasksContext },
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName === "suggestIssue") {
        const input = toolCall.input as SuggestedIssue;

        // Build updates object - only include fields that have values
        const updates: Partial<IssueFormState> = {};
        const fieldsToHighlight: (keyof IssueFormState)[] = [];

        if (input.title) {
          updates.title = input.title;
          fieldsToHighlight.push("title");
        }
        if (input.description) {
          updates.description = input.description;
          fieldsToHighlight.push("description");
        }
        if (input.priority !== undefined && input.priority !== null) {
          updates.priority = input.priority as Priority;
          fieldsToHighlight.push("priority");
        }

        // Only update if we have something to update
        if (Object.keys(updates).length > 0) {
          updateForm(updates);
          highlightFields(fieldsToHighlight);
        }
      }

      if (toolCall.toolName === "suggestSubtasks") {
        const input = toolCall.input as {
          subtasks: SuggestedSubtaskInput[];
          replaceExisting?: boolean;
        };
        // Clear existing subtasks if replaceExisting is true (default)
        if (input.replaceExisting !== false) {
          clearSuggestedSubtasks();
        }
        // Add new subtasks if any provided
        if (input?.subtasks?.length > 0) {
          addSuggestedSubtasks(
            input.subtasks.map((s) => ({
              title: s.title,
              description: s.description,
              priority: (s.priority ?? 4) as Priority,
            }))
          );
        }
      }
    },
  });

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
      header={{
        title: "AI Assistant",
        subtitle: "Helping you write better user stories",
        icon: <Sparkles className="w-4 h-4 text-primary" />,
      }}
      welcomeMessage="Hi! I'm here to help you craft a great user story. What would you like to build today?"
      renderToolCall={(toolName, result, index) => {
        // Only show custom messages for our form-related tools
        if (toolName === "suggestIssue") {
          return (
            <div
              key={`tool-${index}`}
              className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50"
            >
              <Sparkles className="w-3 h-3" />
              <span>Form populated with suggestion</span>
            </div>
          );
        }
        if (toolName === "suggestSubtasks") {
          const input = result as { subtasks: SuggestedSubtaskInput[]; replaceExisting?: boolean };
          const count = input?.subtasks?.length || 0;
          const action = input?.replaceExisting === false ? "Added" : "Updated to";
          return (
            <div
              key={`tool-${index}`}
              className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50"
            >
              <Sparkles className="w-3 h-3" />
              <span>
                {action} {count} subtask{count !== 1 ? "s" : ""}
              </span>
            </div>
          );
        }
        // For other tools (web_search, web_fetch, etc.), return null to use default rendering
        return null;
      }}
      inputPlaceholder="Describe what you'd like to build..."
      showAttachmentButton
      files={chat.files}
      onFilesChange={chat.setFiles}
    />
  );
}
