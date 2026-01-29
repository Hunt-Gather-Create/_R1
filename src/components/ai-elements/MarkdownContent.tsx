"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Check, Copy } from "lucide-react";
import { cn, transformCiteTags } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

interface CodeBlockProps {
  children: string;
  className?: string;
  language?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "absolute top-2 right-2 p-1.5 rounded-md transition-colors",
        "bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground",
        "opacity-0 group-hover:opacity-100"
      )}
      title={copied ? "Copied!" : "Copy code"}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

function CodeBlock({ children, className, language }: CodeBlockProps) {
  const code = String(children).replace(/\n$/, "");

  return (
    <div className="relative group my-2">
      {language && (
        <div className="absolute top-0 left-0 px-2 py-0.5 text-[10px] text-muted-foreground bg-muted/50 rounded-tl rounded-br">
          {language}
        </div>
      )}
      <CopyButton text={code} />
      <pre
        className={cn(
          "text-xs bg-muted/50 p-3 rounded overflow-x-auto",
          language && "pt-6",
          className
        )}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none overflow-x-auto [&_li>p]:inline [&_li>p]:m-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          // Style citation links from web search results
          a: ({ href, className, children, ...props }) => {
            const isCitation = className === "citation-link";
            return (
              <a
                href={href}
                className={cn(
                  "inline",
                  isCitation
                    ? "text-primary/80 hover:text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid transition-colors"
                    : "text-primary hover:underline"
                )}
                {...props}
              >
                {children}
              </a>
            );
          },
                    // Handle fenced code blocks (```code```)
          code: ({ children, className, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match && !className;

            if (isInline) {
              // Inline code
              return (
                <code
                  className="px-1 py-0.5 bg-muted rounded text-xs"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            // Block code
            return (
              <CodeBlock language={match?.[1]}>
                {String(children)}
              </CodeBlock>
            );
          },
          // Remove the default pre wrapper since we handle it in CodeBlock
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {transformCiteTags(content)}
      </ReactMarkdown>
    </div>
  );
}
