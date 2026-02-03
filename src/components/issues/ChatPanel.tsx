"use client";

import { Sparkles } from "lucide-react";
import { useChatCore } from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";
import { useBoardContext } from "@/components/board/context/BoardProvider";
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

  const chat = useChatCore({
    api: "/api/chat",
    transportBody: { workspaceId, workspacePurpose },
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
      renderToolCall={() => (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
          <Sparkles className="w-3 h-3" />
          <span>Form populated with suggestion</span>
        </div>
      )}
      inputPlaceholder="Describe what you'd like to build..."
      showAttachmentButton
      files={chat.files}
      onFilesChange={chat.setFiles}
    />
  );
}
