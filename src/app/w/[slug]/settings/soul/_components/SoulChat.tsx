"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, User, Trash2 } from "lucide-react";
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
import type { WorkspaceSoul } from "@/lib/types";
import {
  getSoulChatMessages,
  saveSoulChatMessage,
  deleteSoulChatMessages,
  type SoulChatMessage,
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

// Convert stored messages to UIMessage format
function storedToUIMessages(stored: SoulChatMessage[]): UIMessage[] {
  return stored.map((m) => {
    try {
      const parts = JSON.parse(m.content);
      return {
        id: m.id,
        role: m.role,
        parts,
      };
    } catch {
      return {
        id: m.id,
        role: m.role,
        parts: [{ type: "text" as const, text: m.content }],
      };
    }
  });
}

export function SoulChat({
  workspaceId,
  currentSoul,
  initialPrompt,
  onSoulChange,
}: SoulChatProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const processedToolCallsRef = useRef<Set<string>>(new Set());
  const initialPromptSentRef = useRef(false);
  const savedMessageIdsRef = useRef<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const [loadedMessages, setLoadedMessages] = useState<UIMessage[] | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load existing messages on mount
  useEffect(() => {
    async function loadMessages() {
      try {
        const stored = await getSoulChatMessages(workspaceId);
        if (stored.length > 0) {
          const uiMessages = storedToUIMessages(stored);
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

  const transport = new DefaultChatTransport({
    api: "/api/workspace/soul",
    body: {
      currentSoul,
      workspaceId,
    },
  });

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
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
            content: JSON.stringify(message.parts),
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

  const handleDeleteConversation = async () => {
    if (!confirm("Delete this conversation? The AI will start fresh but will know the current persona configuration.")) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSoulChatMessages(workspaceId);
      setMessages([]);
      savedMessageIdsRef.current.clear();
      processedToolCallsRef.current.clear();
      initialPromptSentRef.current = false;
    } catch {
      // Silent fail - conversation remains
    } finally {
      setIsDeleting(false);
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-medium text-foreground">Persona Configuration</h3>
          <p className="text-xs text-muted-foreground">
            {messages.length === 0
              ? "Start a conversation to configure your AI"
              : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleDeleteConversation}
            disabled={isDeleting || isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors disabled:opacity-50"
            title="Delete conversation"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Bot className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              Tell me how you&apos;d like to adjust your AI assistant&apos;s personality.
            </p>
          </div>
        )}
        {messages.map((message) => (
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
            placeholder="Describe your preferences..."
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
