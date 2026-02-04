"use client";

import { useRef, useCallback, useEffect } from "react";
import { Bot } from "lucide-react";
import {
  useChatCore,
  useSoulChatMessages,
  useSaveSoulChatMessage,
  useClearSoulChatMessages,
} from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";
import { ChatLoadingIndicator } from "@/components/ai-elements/ChatMessageBubble";
import { persistedToUIMessagesBase, serializeMessageParts } from "@/lib/chat/message-persistence";
import type { WorkspaceSoul } from "@/lib/types";

interface SoulChatProps {
  workspaceId: string;
  currentSoul: WorkspaceSoul;
  initialPrompt?: string;
  onSoulChange: (soul: WorkspaceSoul) => void;
}

interface ToolOutput {
  success: boolean;
  action: string;
  name?: string;
  personality?: string;
  goals?: string[];
  tone?: WorkspaceSoul["tone"];
  responseLength?: WorkspaceSoul["responseLength"];
  expertise?: string[];
  term?: string;
  definition?: string;
  rules?: string[];
  greeting?: string;
}

export function SoulChat({
  workspaceId,
  currentSoul,
  initialPrompt,
  onSoulChange,
}: SoulChatProps) {
  const processedToolCallsRef = useRef<Set<string>>(new Set());
  const initialPromptSentRef = useRef(false);

  // TanStack Query hooks for persistence
  const { isLoading: isLoadingHistory } = useSoulChatMessages(workspaceId);
  const saveChatMutation = useSaveSoulChatMessage(workspaceId);
  const clearChatMutation = useClearSoulChatMessages(workspaceId);

  const {
    messages,
    sendMessage,
    status,
    isLoading,
    input,
    setInput,
    containerRef,
    textareaRef,
    spacerHeight,
    handleSubmit,
    handleClearHistory,
  } = useChatCore({
    api: "/api/workspace/soul",
    transportBody: {
      currentSoul,
      workspaceId,
    },
    persistence: {
      entityId: workspaceId,
      useMessages: useSoulChatMessages,
      toUIMessages: persistedToUIMessagesBase,
      onSaveMessage: (message) => {
        saveChatMutation.mutate({
          id: message.id,
          role: message.role as "user" | "assistant",
          content: serializeMessageParts(message.parts),
        });
      },
      onClearMessages: async () => {
        await clearChatMutation.mutateAsync();
        // Reset tool processing state when clearing
        processedToolCallsRef.current.clear();
        initialPromptSentRef.current = false;
      },
    },
  });

  // Send initial prompt if no existing conversation
  useEffect(() => {
    if (
      initialPrompt &&
      !initialPromptSentRef.current &&
      !isLoadingHistory &&
      messages.length === 0 &&
      status === "ready"
    ) {
      initialPromptSentRef.current = true;
      sendMessage({ text: initialPrompt });
    }
  }, [initialPrompt, sendMessage, isLoadingHistory, messages.length, status]);

  // Process tool calls to update soul configuration
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
          case "setSoulName":
            if (output.name) {
              onSoulChange({ ...currentSoul, name: output.name });
            }
            break;

          case "setSoulPersonality":
            if (output.personality) {
              onSoulChange({ ...currentSoul, personality: output.personality });
            }
            break;

          case "setPrimaryGoals":
            if (output.goals) {
              onSoulChange({ ...currentSoul, primaryGoals: output.goals });
            }
            break;

          case "setTone":
            if (output.tone) {
              onSoulChange({ ...currentSoul, tone: output.tone });
            }
            break;

          case "setResponseLength":
            if (output.responseLength) {
              onSoulChange({ ...currentSoul, responseLength: output.responseLength });
            }
            break;

          case "setDomainExpertise":
            if (output.expertise) {
              onSoulChange({ ...currentSoul, domainExpertise: output.expertise });
            }
            break;

          case "addTerminology":
            if (output.term && output.definition) {
              onSoulChange({
                ...currentSoul,
                terminology: {
                  ...currentSoul.terminology,
                  [output.term]: output.definition,
                },
              });
            }
            break;

          case "setDoRules":
            if (output.rules) {
              onSoulChange({ ...currentSoul, doRules: output.rules });
            }
            break;

          case "setDontRules":
            if (output.rules) {
              onSoulChange({ ...currentSoul, dontRules: output.rules });
            }
            break;

          case "setGreeting":
            if (output.greeting) {
              onSoulChange({ ...currentSoul, greeting: output.greeting });
            }
            break;
        }
      }
    }
  }, [messages, currentSoul, onSoulChange]);

  useEffect(() => {
    processToolCalls();
  }, [processToolCalls]);

  // Show loading while fetching initial messages
  if (isLoadingHistory) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground mt-2">Loading conversation...</p>
      </div>
    );
  }

  return (
    <ChatContainer
      messages={messages}
      containerRef={containerRef}
      textareaRef={textareaRef}
      spacerHeight={spacerHeight}
      isLoading={isLoading}
      input={input}
      onInputChange={setInput}
      onSubmit={handleSubmit}
      header={{
        title: "Persona Configuration",
        subtitle:
          messages.length === 0
            ? "Start a conversation to configure your AI"
            : `${messages.length} message${messages.length === 1 ? "" : "s"}`,
        showClearButton: true,
        clearConfirmMessage:
          "Delete this conversation? The AI will start fresh but will know the current persona configuration.",
      }}
      onClearHistory={handleClearHistory}
      emptyState={
        <div className="text-center py-8">
          <Bot className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            Tell me how you&apos;d like to adjust your AI assistant&apos;s personality.
          </p>
        </div>
      }
      inputPlaceholder="Describe your preferences..."
      LoadingIndicator={ChatLoadingIndicator}
    />
  );
}
