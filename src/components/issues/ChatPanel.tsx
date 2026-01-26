"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, User, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { workspaceId, workspacePurpose },
      }),
    [workspaceId, workspacePurpose]
  );

  const { messages, sendMessage, status } = useChat({
    transport,
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

  // Add welcome message if no messages exist
  const displayMessages =
    messages.length === 0
      ? [
          {
            id: "welcome",
            role: "assistant" as const,
            parts: [
              {
                type: "text" as const,
                text: "Hi! I'm here to help you craft a great user story. What would you like to build today?",
              },
            ],
          },
        ]
      : messages;

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = () => {
    if (input.trim()) {
      sendMessage({ text: input });
      setInput("");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b border-border shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-medium">AI Assistant</h3>
          <p className="text-xs text-muted-foreground">
            Helping you write better user stories
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {displayMessages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex gap-3",
              message.role === "user" ? "flex-row-reverse" : "flex-row"
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-7 h-7 rounded-full shrink-0",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              {message.role === "user" ? (
                <User className="w-4 h-4" />
              ) : (
                <Bot className="w-4 h-4" />
              )}
            </div>
            <div
              className={cn(
                "flex flex-col gap-1 max-w-[85%]",
                message.role === "user" ? "items-end" : "items-start"
              )}
            >
              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                {message.parts.map((part, index) => {
                  if (part.type === "text") {
                    return (
                      <div
                        key={index}
                        className="prose prose-sm dark:prose-invert max-w-none"
                      >
                        <ReactMarkdown>{part.text}</ReactMarkdown>
                      </div>
                    );
                  }
                  // Tool calls show a confirmation message
                  if (part.type?.startsWith("tool-")) {
                    return (
                      <div
                        key={index}
                        className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Form populated with suggestion</span>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
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
        )}
        <div ref={messagesEndRef} />
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
            placeholder="Describe what you'd like to build..."
            rows={1}
          />
          <PromptInputSubmit />
        </PromptInput>
      </div>
    </div>
  );
}
