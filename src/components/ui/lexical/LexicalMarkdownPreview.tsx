"use client";

import { useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $convertFromMarkdownString,
} from "@lexical/markdown";
import { $getRoot } from "lexical";
import {
  LEXICAL_NODES,
  LEXICAL_THEME,
  MARKDOWN_TRANSFORMERS,
} from "./shared";
import { CodeBlockEnhancerPlugin } from "./CodeBlockEnhancerPlugin";

// ---------------------------------------------------------------------------
// SyncContentPlugin — watches the `content` prop and re-parses when changed.
// Debounces at ~50ms to handle streaming updates smoothly.
// ---------------------------------------------------------------------------

function SyncContentPlugin({ content }: { content: string }) {
  const [editor] = useLexicalComposerContext();
  const lastRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (content === lastRef.current) return;
    lastRef.current = content;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        if (content.trim().length > 0) {
          $convertFromMarkdownString(content, MARKDOWN_TRANSFORMERS);
        }
      });
    }, 50);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editor, content]);

  return null;
}

// ---------------------------------------------------------------------------
// LexicalMarkdownPreview
// ---------------------------------------------------------------------------

interface LexicalMarkdownPreviewProps {
  content: string;
  className?: string;
}

export function LexicalMarkdownPreview({
  content,
  className,
}: LexicalMarkdownPreviewProps) {
  const initialConfig = useMemo(
    () => ({
      namespace: "lexical-markdown-preview",
      editable: false,
      onError(error: Error) {
        console.error("LexicalMarkdownPreview error:", error);
      },
      nodes: LEXICAL_NODES,
      editorState: () => {
        if (content.trim().length > 0) {
          $convertFromMarkdownString(content, MARKDOWN_TRANSFORMERS);
        }
      },
      theme: LEXICAL_THEME,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on first render
    [],
  );

  return (
    <div
      className={cn(
        "lexical-preview prose prose-sm dark:prose-invert max-w-none",
        "[&_li>p]:inline [&_li>p]:m-0",
        className,
      )}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable className="outline-none text-sm leading-6" />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ListPlugin />
        <LinkPlugin />
        <CodeBlockEnhancerPlugin />
        <SyncContentPlugin content={content} />
      </LexicalComposer>
    </div>
  );
}
