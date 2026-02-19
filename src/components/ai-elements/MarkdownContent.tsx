"use client";

import { memo } from "react";
import { cn, transformCiteTagsToMarkdown, normalizeLineBreaks } from "@/lib/utils";
import { LexicalMarkdownPreview } from "@/components/ui/lexical";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  className,
}: MarkdownContentProps) {
  const processed = normalizeLineBreaks(transformCiteTagsToMarkdown(content));

  return (
    <LexicalMarkdownPreview
      content={processed}
      className={cn("overflow-x-auto [&_li>p]:inline [&_li>p]:m-0", className)}
    />
  );
});
