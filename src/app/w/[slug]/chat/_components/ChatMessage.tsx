"use client";

import { Bot, User, FileText } from "lucide-react";
import { MarkdownContent } from "@/components/ai-elements/MarkdownContent";
import { ToolResultDisplay } from "@/components/ai-elements/ToolResultDisplay";
import {
  CollapsibleFileContent,
  parseTextWithFileAttachments,
} from "@/components/ai-elements/CollapsibleFileContent";
import {
  UserFileAttachment,
  type UserFilePart,
} from "@/components/ai-elements/UserFileAttachment";
import { useChatContext } from "./ChatContext";
import { formatFileSize } from "./chat-utils";
import { cn } from "@/lib/utils";
import type { UIMessage } from "@ai-sdk/react";

interface CreateFileResult {
  success: boolean;
  attachmentId?: string;
  filename?: string;
  size?: number;
  error?: string;
}

interface ChatMessageProps {
  message: UIMessage;
}

function FileAttachmentCard({
  result,
  onView,
}: {
  result: CreateFileResult;
  onView?: () => void;
}) {
  if (!result.success || !result.filename) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-500 mt-2 pt-2 border-t border-border/50">
        <FileText className="w-3 h-3" />
        <span>Failed to create file: {result.error || "Unknown error"}</span>
      </div>
    );
  }

  const ext = result.filename.split(".").pop()?.toUpperCase() || "";
  // Show truncated ID for reference (first 8 chars)
  const shortId = result.attachmentId?.slice(0, 8);

  return (
    <button
      onClick={onView}
      className={cn(
        "flex items-center gap-3 w-full max-w-sm mt-3 p-3 rounded-lg",
        "bg-background/50 hover:bg-background border border-border/50",
        "transition-colors text-left"
      )}
      title={
        result.attachmentId
          ? `Attachment ID: ${result.attachmentId}`
          : undefined
      }
    >
      {/* Icon */}
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted border border-border text-muted-foreground">
        <FileText className="w-4 h-4" />
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{result.filename}</p>
        <p className="text-xs text-muted-foreground">
          Document · {ext} {result.size && `· ${formatFileSize(result.size)}`}
          {shortId && <span className="ml-1 opacity-50">· #{shortId}</span>}
        </p>
      </div>
    </button>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { viewAttachment } = useChatContext();
  const isUser = message.role === "user";

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
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              // Check if this is a user message with embedded file content
              if (isUser && part.text.includes("\n\n--- ")) {
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

            // Handle user-attached files (from sendMessage with files)
            if (part.type === "file") {
              const filePart = part as unknown as UserFilePart;
              return <UserFileAttachment key={index} part={filePart} />;
            }

            // Handle persisted file attachments (loaded from database)
            // Use string cast since "file-attachment" is a custom type not in UIMessage
            const partType = part.type as string;
            if (partType === "file-attachment") {
              const attachmentPart = part as unknown as {
                type: string;
                attachmentId: string;
                filename: string;
                size?: number;
              };
              return (
                <FileAttachmentCard
                  key={index}
                  result={{
                    success: true,
                    attachmentId: attachmentPart.attachmentId,
                    filename: attachmentPart.filename,
                    size: attachmentPart.size,
                  }}
                  onView={() => viewAttachment(attachmentPart.attachmentId)}
                />
              );
            }

            // Handle tool parts - type is "tool-{toolName}"
            if (partType.startsWith("tool-")) {
              const toolPart = part as unknown as {
                type: string;
                toolCallId: string;
                state: string;
                input: unknown;
                output?: unknown;
              };

              // Extract tool name from type (e.g., "tool-createFile" -> "createFile")
              const toolName = partType.replace("tool-", "");

              // Only show results when output is available
              if (toolPart.state !== "output-available") {
                return null;
              }

              // Handle createFile tool specially
              if (toolName === "createFile" && toolPart.output) {
                const result = toolPart.output as CreateFileResult;
                return (
                  <FileAttachmentCard
                    key={index}
                    result={result}
                    onView={
                      result.attachmentId
                        ? () => viewAttachment(result.attachmentId!)
                        : undefined
                    }
                  />
                );
              }

              // Handle other tools
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
}

export function LoadingMessage() {
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
