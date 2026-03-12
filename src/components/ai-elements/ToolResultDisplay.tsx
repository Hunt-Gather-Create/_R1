"use client";

import { Search, Code, Globe, Terminal, FileEdit, FileText, CheckCircle, XCircle } from "lucide-react";
import { PlatformConnectResult } from "./PlatformConnectResult";

interface ToolResultDisplayProps {
  toolName: string;
  result?: unknown;
  workspaceId?: string;
}

// Extract useful info from tool result objects
function extractResultInfo(result: unknown): { success: boolean; message?: string } {
  if (!result || typeof result !== "object") {
    return { success: true };
  }

  const res = result as Record<string, unknown>;

  // Check for explicit success field
  if ("success" in res && res.success === false) {
    return { success: false, message: res.error as string };
  }

  // Check for error indicators
  if (res.error_code || res.error || (res.type as string)?.includes("error")) {
    return { success: false, message: res.error_code as string || res.error as string };
  }

  // Check return code for bash results
  if ("return_code" in res && res.return_code !== 0) {
    return { success: false, message: res.stderr as string };
  }

  return { success: true };
}

export function ToolResultDisplay({ toolName, result, workspaceId }: ToolResultDisplayProps) {
  // Platform connection
  if (toolName === "connect_platform" && result != null) {
    const resultStr =
      typeof result === "string" ? result : JSON.stringify(result);
    return <PlatformConnectResult result={resultStr} workspaceId={workspaceId} />;
  }

  // Web search
  if (toolName === "web_search") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        <Search className="w-3 h-3" />
        <span>Searched the web</span>
      </div>
    );
  }

  // Web fetch
  if (toolName === "web_fetch") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        <Globe className="w-3 h-3" />
        <span>Fetched URL content</span>
      </div>
    );
  }

  // Text editor / file operations (MCP tools)
  if (toolName === "text_editor" || toolName.startsWith("str_replace") || toolName.includes("editor")) {
    const info = extractResultInfo(result);
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        <FileEdit className="w-3 h-3" />
        <span>File operation</span>
        {info.success ? (
          <CheckCircle className="w-3 h-3 text-green-500" />
        ) : (
          <XCircle className="w-3 h-3 text-red-500" />
        )}
      </div>
    );
  }

  // Bash / shell execution (MCP tools)
  if (toolName === "bash" || toolName.includes("bash") || toolName.includes("shell")) {
    const info = extractResultInfo(result);
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        <Terminal className="w-3 h-3" />
        <span>Command executed</span>
        {info.success ? (
          <CheckCircle className="w-3 h-3 text-green-500" />
        ) : (
          <XCircle className="w-3 h-3 text-red-500" />
        )}
      </div>
    );
  }

  // Code execution (built-in)
  if (toolName === "code_execution") {
    const info = extractResultInfo(result);
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        <Code className="w-3 h-3" />
        <span>Code executed</span>
        {info.success ? (
          <CheckCircle className="w-3 h-3 text-green-500" />
        ) : (
          <XCircle className="w-3 h-3 text-red-500" />
        )}
      </div>
    );
  }

  // Read file tool - show filename that was read
  if (toolName === "readFile") {
    const info = extractResultInfo(result);
    const res = result as Record<string, unknown> | undefined;
    const filename = res?.filename as string | undefined;
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        <FileText className="w-3 h-3" />
        <span className="truncate max-w-[200px]">
          {info.success ? `Read ${filename || "file"}` : "Failed to read file"}
        </span>
        {info.success ? (
          <CheckCircle className="w-3 h-3 text-green-500" />
        ) : (
          <XCircle className="w-3 h-3 text-red-500" />
        )}
      </div>
    );
  }

  // List files tool - show count of files found
  if (toolName === "listFiles") {
    const info = extractResultInfo(result);
    const res = result as Record<string, unknown> | undefined;
    const count = res?.count as number | undefined;
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        <FileText className="w-3 h-3" />
        <span>
          {info.success
            ? `Found ${count ?? 0} file${count === 1 ? "" : "s"}`
            : "Failed to list files"}
        </span>
        {info.success ? (
          <CheckCircle className="w-3 h-3 text-green-500" />
        ) : (
          <XCircle className="w-3 h-3 text-red-500" />
        )}
      </div>
    );
  }

  // For unknown tools, show a minimal indicator instead of raw JSON
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
      <Code className="w-3 h-3" />
      <span className="truncate max-w-[200px]">{toolName.replace(/_/g, " ")}</span>
    </div>
  );
}
