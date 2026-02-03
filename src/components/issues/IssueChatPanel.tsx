"use client";

import { useMemo } from "react";
import { Sparkles, Trash2, Paperclip } from "lucide-react";
import { useChatCore } from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";
import { ToolResultDisplay } from "@/components/ai-elements/ToolResultDisplay";
import {
  useIssueChatMessages,
  useSaveChatMessage,
  useClearChatMessages,
  useInvalidateAttachments,
  useInvalidateAISuggestions,
  useInvalidateSubtasks,
  useIssueSubtasks,
} from "@/lib/hooks";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { persistedToUIMessagesBase, serializeMessageParts } from "@/lib/chat/message-persistence";
import type { IssueWithLabels, Comment } from "@/lib/types";

interface SubtaskContext {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  aiAssignable: boolean;
}

interface IssueContext {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  comments: Array<{ body: string }>;
  subtasks: SubtaskContext[];
}

interface IssueChatPanelProps {
  issue: IssueWithLabels;
  comments: Comment[];
  onUpdateDescription: (description: string) => void;
}

export function IssueChatPanel({
  issue,
  comments,
  onUpdateDescription,
}: IssueChatPanelProps) {
  const { workspaceId, workspacePurpose } = useBoardContext();

  // Use TanStack Query for chat messages - auto-cancels on unmount
  const { isLoading: isLoadingHistory } = useIssueChatMessages(issue.id);
  const saveChatMutation = useSaveChatMessage(issue.id);
  const clearChatMutation = useClearChatMessages(issue.id);
  const invalidateAttachments = useInvalidateAttachments(issue.id);
  const invalidateAISuggestions = useInvalidateAISuggestions(issue.id);
  const invalidateSubtasks = useInvalidateSubtasks(issue.id);

  // Fetch subtasks for context
  const { data: subtasks = [] } = useIssueSubtasks(issue.id);

  // Build issue context for the API
  const issueContext: IssueContext = useMemo(
    () => ({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      comments: comments.map((c) => ({ body: c.body })),
      subtasks: subtasks.map((s) => ({
        id: s.id,
        identifier: s.identifier,
        title: s.title,
        description: s.description,
        priority: s.priority,
        status: s.status,
        aiAssignable: s.aiAssignable,
      })),
    }),
    [issue.id, issue.title, issue.description, issue.status, issue.priority, comments, subtasks]
  );

  const chat = useChatCore({
    api: "/api/chat/issue",
    transportBody: { issueContext, workspaceId, workspacePurpose },
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
      if (toolCall.toolName === "suggestAITasks") {
        // Refresh AI suggestions after AI creates new suggestions
        // Small delay to ensure server-side processing is complete
        setTimeout(() => invalidateAISuggestions(), 500);
      }
      if (toolCall.toolName === "updateSubtask" || toolCall.toolName === "deleteSubtask") {
        // Refresh subtasks after AI updates or deletes a subtask
        // Small delay to ensure server-side processing is complete
        setTimeout(() => invalidateSubtasks(), 500);
      }
    },
    persistence: {
      entityId: issue.id,
      useMessages: useIssueChatMessages,
      toUIMessages: persistedToUIMessagesBase,
      onSaveMessage: (message) => {
        saveChatMutation.mutate({
          role: message.role,
          content: serializeMessageParts(message.parts),
        });
      },
      onClearMessages: async () => {
        await clearChatMutation.mutateAsync();
      },
    },
  });

  // Build welcome message with issue title
  const welcomeMessage = `I'm here to help you refine **${issue.title}**. I can see the current description, status, and any comments.\n\nHow can I help? For example:\n- "Add acceptance criteria"\n- "Suggest improvements to the description"\n- "Break this down into smaller tasks"`;

  return (
    <ChatContainer
      messages={chat.messages}
      containerRef={chat.containerRef}
      textareaRef={chat.textareaRef}
      spacerHeight={chat.spacerHeight}
      isLoading={chat.isLoading}
      isLoadingHistory={isLoadingHistory}
      input={chat.input}
      onInputChange={chat.setInput}
      onSubmit={chat.handleSubmit}
      header={{
        title: "AI Assistant",
        showClearButton: true,
      }}
      onClearHistory={chat.handleClearHistory}
      welcomeMessage={welcomeMessage}
      renderToolCall={(toolName, result, index) => {
        // Handle custom tool (updateDescription)
        if (toolName === "updateDescription") {
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
        if (toolName === "attachContent") {
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
        // Handle suggestAITasks tool
        if (toolName === "suggestAITasks") {
          return (
            <div
              key={index}
              className="flex items-center gap-2 text-xs text-purple-500 mt-2 pt-2 border-t border-border/50"
            >
              <Sparkles className="w-3 h-3" />
              <span>AI tasks suggested - see subtasks section</span>
            </div>
          );
        }
        // Handle updateSubtask tool
        if (toolName === "updateSubtask") {
          const resultStr = typeof result === "string" ? result : "";
          const failed = resultStr.toLowerCase().includes("failed");
          return (
            <div
              key={index}
              className={`flex items-center gap-2 text-xs mt-2 pt-2 border-t border-border/50 ${failed ? "text-red-500" : "text-muted-foreground"}`}
            >
              <Sparkles className="w-3 h-3" />
              <span>{resultStr || "Subtask updated"}</span>
            </div>
          );
        }
        // Handle deleteSubtask tool
        if (toolName === "deleteSubtask") {
          const resultStr = typeof result === "string" ? result : "";
          const failed = resultStr.toLowerCase().includes("failed");
          return (
            <div
              key={index}
              className={`flex items-center gap-2 text-xs mt-2 pt-2 border-t border-border/50 ${failed ? "text-red-500" : "text-muted-foreground"}`}
            >
              <Trash2 className="w-3 h-3" />
              <span>{resultStr || "Subtask deleted"}</span>
            </div>
          );
        }
        // Handle built-in tools
        return <ToolResultDisplay key={index} toolName={toolName} result={result} />;
      }}
      inputPlaceholder="Ask to refine requirements, add acceptance criteria..."
      showAttachmentButton
      files={chat.files}
      onFilesChange={chat.setFiles}
    />
  );
}
