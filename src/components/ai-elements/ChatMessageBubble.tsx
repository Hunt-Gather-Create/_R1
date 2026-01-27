"use client";

import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessageBubbleProps {
  role: "user" | "assistant";
  children: React.ReactNode;
}

export function ChatMessageBubble({ role, children }: ChatMessageBubbleProps) {
  const isUser = role === "user";

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
            "rounded-lg px-3 py-2 text-sm",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function ChatLoadingIndicator() {
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
