"use client";

import { Search, Code, Globe } from "lucide-react";

interface ToolResultDisplayProps {
  toolName: string;
  result?: unknown;
}

export function ToolResultDisplay({ toolName, result }: ToolResultDisplayProps) {
  if (toolName === "web_search") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        <Search className="w-3 h-3" />
        <span>Searched the web</span>
      </div>
    );
  }

  if (toolName === "code_execution") {
    const output =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return (
      <div className="mt-2 pt-2 border-t border-border/50">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Code className="w-3 h-3" />
          <span>Code execution</span>
        </div>
        {output && (
          <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto">
            {output}
          </pre>
        )}
      </div>
    );
  }

  if (toolName === "web_fetch") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
        <Globe className="w-3 h-3" />
        <span>Fetched URL content</span>
      </div>
    );
  }

  return null;
}
