"use client";

import { memo } from "react";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import {
  CollapsibleFileContent,
  parseTextWithFileAttachments,
} from "./CollapsibleFileContent";
import { UserFileAttachment } from "./UserFileAttachment";
import { ToolResultDisplay } from "./ToolResultDisplay";

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
}

interface ChatMessageItemProps {
  message: Message;
  renderToolCall?: (part: MessagePart, index: number) => React.ReactNode;
}

export const ChatMessageItem = memo(function ChatMessageItem({ message, renderToolCall }: ChatMessageItemProps) {
  // Skip system messages - they're not displayed in chat
  if (message.role === "system") {
    return null;
  }

  return (
    <div
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
            if (part.type === "text" && part.text) {
              // Check if this is a user message with embedded file content
              if (message.role === "user" && part.text.includes("\n\n--- ")) {
                const { mainText, filesSections } = parseTextWithFileAttachments(part.text);
                return (
                  <div key={index}>
                    {mainText && <MarkdownContent content={mainText} />}
                    {filesSections.map((file, fileIndex) => (
                      <CollapsibleFileContent
                        key={`file-${fileIndex}`}
                        filename={file.filename}
                        content={file.content}
                      />
                    ))}
                  </div>
                );
              }
              return <MarkdownContent key={index} content={part.text} />;
            }
            // Handle user-attached files
            if (part.type === "file") {
              const filePart = part as unknown as {
                type: "file";
                mediaType: string;
                url: string;
                filename?: string;
              };
              return <UserFileAttachment key={index} part={filePart} />;
            }
            // Tool calls - delegate to custom renderer if provided, or use default
            if (part.type?.startsWith("tool-")) {
              const toolPart = part as MessagePart & { state?: string; output?: unknown };

              // Only show results when output is available
              if (toolPart.state !== "output-available") {
                return null;
              }

              // Use custom renderer if provided
              if (renderToolCall) {
                return renderToolCall(part, index);
              }

              // Default: show tool result display
              const toolName = part.type.replace("tool-", "");
              return (
                <ToolResultDisplay
                  key={index}
                  toolName={toolName}
                  result={toolPart.output}
                />
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
});
