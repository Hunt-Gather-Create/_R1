"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { Bot } from "lucide-react";
import { useChatCore } from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";
import { ChatLoadingIndicator } from "@/components/ai-elements/ChatMessageBubble";
import { persistedToUIMessagesBase, serializeMessageParts } from "@/lib/chat/message-persistence";
import type { WorkspaceSoul } from "@/lib/types";
import {
  getSoulChatMessages,
  saveSoulChatMessage,
  deleteSoulChatMessages,
} from "@/lib/actions/soul";

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
  const savedMessageIdsRef = useRef<Set<string>>(new Set());
  const [loadedMessages, setLoadedMessages] = useState<UIMessage[] | null>(null);

  // Load existing messages on mount
  useEffect(() => {
    async function loadMessages() {
      try {
        const stored = await getSoulChatMessages(workspaceId);
        if (stored.length > 0) {
          const uiMessages = persistedToUIMessagesBase(stored);
          setLoadedMessages(uiMessages);
          // Mark these as already saved
          stored.forEach((m) => savedMessageIdsRef.current.add(m.id));
        } else {
          setLoadedMessages([]);
        }
      } catch {
        setLoadedMessages([]);
      }
    }
    loadMessages();
  }, [workspaceId]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    isLoading,
    input,
    setInput,
    containerRef,
    textareaRef,
    spacerHeight,
    handleSubmit,
  } = useChatCore({
    api: "/api/workspace/soul",
    transportBody: {
      currentSoul,
      workspaceId,
    },
  });

  // Set messages when loaded from storage
  useEffect(() => {
    if (loadedMessages && loadedMessages.length > 0 && messages.length === 0) {
      setMessages(loadedMessages);
    }
  }, [loadedMessages, setMessages, messages.length]);

  // Send initial prompt if no existing conversation
  useEffect(() => {
    if (
      initialPrompt &&
      !initialPromptSentRef.current &&
      loadedMessages !== null &&
      loadedMessages.length === 0
    ) {
      initialPromptSentRef.current = true;
      sendMessage({ text: initialPrompt });
    }
  }, [initialPrompt, sendMessage, loadedMessages]);

  // Save new messages to database
  useEffect(() => {
    async function saveMessages() {
      for (const message of messages) {
        if (savedMessageIdsRef.current.has(message.id)) continue;

        // Only save complete messages (not streaming)
        if (status === "streaming" && message === messages[messages.length - 1] && message.role === "assistant") {
          continue;
        }

        savedMessageIdsRef.current.add(message.id);
        try {
          await saveSoulChatMessage(workspaceId, {
            id: message.id,
            role: message.role as "user" | "assistant",
            content: serializeMessageParts(message.parts),
          });
        } catch {
          savedMessageIdsRef.current.delete(message.id);
        }
      }
    }

    if (status === "ready" && messages.length > 0) {
      saveMessages();
    }
  }, [messages, status, workspaceId]);

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

  const handleDeleteConversation = async () => {
    if (!confirm("Delete this conversation? The AI will start fresh but will know the current persona configuration.")) {
      return;
    }

    try {
      await deleteSoulChatMessages(workspaceId);
      setMessages([]);
      savedMessageIdsRef.current.clear();
      processedToolCallsRef.current.clear();
      initialPromptSentRef.current = false;
    } catch {
      // Silent fail - conversation remains
    }
  };

  // Show loading while fetching initial messages
  if (loadedMessages === null) {
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
      }}
      onClearHistory={handleDeleteConversation}
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
