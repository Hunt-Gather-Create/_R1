"use client";

import { useMemo, useRef, useEffect } from "react";
import { Sparkles, Trash2, Paperclip } from "lucide-react";
import { useChatCore } from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";
import { ToolResultDisplay } from "@/components/ai-elements/ToolResultDisplay";
import { AdArtifactInline } from "@/components/ads/AdArtifactInline";
import { attachAdArtifactToIssue } from "@/lib/actions/ad-artifacts";
import {
  useIssueChatMessages,
  useSaveChatMessage,
  useClearChatMessages,
  useInvalidateAttachments,
  useInvalidateAISuggestions,
  useInvalidateSubtasks,
  useIssueSubtasks,
  useIssueComments,
} from "@/lib/hooks";
import { useBoardContext } from "@/components/board/context/BoardProvider";
import { persistedToUIMessagesBase, serializeMessageParts } from "@/lib/chat/message-persistence";
import type { IssueWithLabels } from "@/lib/types";

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
  onViewArtifact?: (artifactId: string, version?: number) => void;
}

export function IssueChatPanel({
  issue,
  onViewArtifact,
}: IssueChatPanelProps) {
  const { workspaceId, workspacePurpose } = useBoardContext();

  // Use TanStack Query for chat messages - auto-cancels on unmount
  const { isLoading: isLoadingHistory } = useIssueChatMessages(issue.id);
  const saveChatMutation = useSaveChatMessage(issue.id);
  const clearChatMutation = useClearChatMessages(issue.id);
  const invalidateAttachments = useInvalidateAttachments(issue.id);
  const invalidateAISuggestions = useInvalidateAISuggestions(issue.id);
  const invalidateSubtasks = useInvalidateSubtasks(issue.id);

  // Fetch subtasks and comments for context
  const { data: subtasks = [] } = useIssueSubtasks(issue.id);
  const { data: comments = [] } = useIssueComments(issue.id);


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
    chatId: issue.id,
    transportBody: { issueContext, workspaceId, workspacePurpose },
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName === "updateDescription") {
        // Description update handled server-side; no form to push to
      }
      // Immediately invalidate relevant queries (best-effort for fast connections).
      // A second invalidation fires when streaming completes to guarantee freshness.
      if (toolCall.toolName === "attachContent" || toolCall.toolName === "deleteAttachment") {
        invalidateAttachments();
      }
      if (toolCall.toolName === "suggestAITasks") {
        invalidateAISuggestions();
      }
      if (toolCall.toolName === "updateSubtask" || toolCall.toolName === "deleteSubtask") {
        invalidateSubtasks();
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

  // Re-invalidate all data queries when streaming completes.
  // Server-side tool executes (suggestAITasks, attachContent, etc.) are guaranteed
  // to have finished by the time the stream ends, so this catches any data the
  // immediate onToolCall invalidations missed due to network latency.
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !chat.isLoading) {
      invalidateAISuggestions();
      invalidateSubtasks();
      invalidateAttachments();
    }
    prevLoadingRef.current = chat.isLoading;
  }, [chat.isLoading, invalidateAISuggestions, invalidateSubtasks, invalidateAttachments]);

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
      renderToolCall={(toolName, result, index, _part, messageId, messageIndex) => {
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
        // Handle ad creation tools
        if (toolName.startsWith("create_ad_") && result) {
          const adResult = result as {
            success: boolean;
            artifactId: string;
            name: string;
            platform: string;
            templateType: string;
          };
          if (adResult.success) {
            // True if this message is the last one (in the chat) that contains a create_ad_ tool call with this artifactId
            const lastMessageIndexWithArtifact = chat.messages.findLastIndex((msg) =>
              (msg.parts ?? []).some(
                (p) =>
                  p.type?.startsWith("tool-create_ad_") &&
                  (p as { output?: { artifactId?: string } }).output?.artifactId === adResult.artifactId
              )
            );

            return (
              <AdArtifactInline
                key={index}
                artifactId={adResult.artifactId}
                name={adResult.name}
                platform={adResult.platform}
                templateType={adResult.templateType}
                workspaceId={workspaceId ?? ""}
                messageId={messageId}
                showPreview={messageIndex !== lastMessageIndexWithArtifact}
                onExpand={(version) => onViewArtifact?.(adResult.artifactId, messageIndex === lastMessageIndexWithArtifact ? undefined : version)}
                onAttach={async () => {
                  await attachAdArtifactToIssue(adResult.artifactId, issue.id);
                  invalidateAttachments();
                }}
              />
            );
          }
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
