"use client";

import { Sparkles } from "lucide-react";
import { useChatCore } from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";
import { ToolResultDisplay } from "@/components/ai-elements/ToolResultDisplay";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import type { Priority } from "@/lib/design-tokens";

export interface PlannedIssue {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  status: "pending" | "creating" | "created";
}

export interface EpicSummary {
  title: string;
  description: string;
}

interface PlanningChatPanelProps {
  onPlanIssue: (issue: Omit<PlannedIssue, "id" | "status">) => void;
  onSummarizeEpic: (summary: EpicSummary) => void;
}

export function PlanningChatPanel({ onPlanIssue, onSummarizeEpic }: PlanningChatPanelProps) {
  const { workspaceId, workspacePurpose } = useBoardContext();

  const chat = useChatCore({
    api: "/api/chat/planning",
    transportBody: { workspaceId, workspacePurpose },
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
      if (toolCall.toolName === "summarizeEpic") {
        const args = toolCall.input as EpicSummary;
        onSummarizeEpic({
          title: args.title,
          description: args.description,
        });
      }
    },
  });

  const welcomeText =
    workspacePurpose === "marketing"
      ? `What campaign or project would you like to plan? Tell me about your goals and I'll help you break it down into actionable tasks.`
      : `What would you like to build? Tell me about your feature or project and I'll help you break it down into actionable issues.`;

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
        title: "AI Planning Assistant",
      }}
      welcomeMessage={welcomeText}
      renderToolCall={(toolName, result, index) => {
        if (toolName === "planIssue") {
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
        if (toolName === "summarizeEpic") {
          return (
            <div
              key={index}
              className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50"
            >
              <Sparkles className="w-3 h-3" />
              <span>Epic summary set</span>
            </div>
          );
        }
        // Handle built-in tools
        return <ToolResultDisplay key={index} toolName={toolName} result={result} />;
      }}
      inputPlaceholder="Describe what you want to build..."
      showAttachmentButton
      files={chat.files}
      onFilesChange={chat.setFiles}
    />
  );
}
