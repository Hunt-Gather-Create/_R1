"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

interface TextPreviewProps {
  previewUrl: string;
  title: string;
}

export function TextPreview({ previewUrl, title }: TextPreviewProps) {
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;

    const loadText = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(previewUrl, {
          method: "GET",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Could not load text preview");
        }

        const text = await response.text();
        if (!isMounted) return;
        setContent(text);
      } catch (textError) {
        if (!isMounted || controller.signal.aborted) return;
        const message =
          textError instanceof Error ? textError.message : "Failed to load preview";
        setError(message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadText();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [previewUrl]);

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center px-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 text-center">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!content.trim()) {
    return (
      <div className="h-full w-full flex items-center justify-center px-4 text-sm text-muted-foreground">
        {title} is empty
      </div>
    );
  }

  return (
    <pre className="h-full w-full overflow-auto whitespace-pre-wrap break-words bg-muted/20 p-4 text-xs leading-5">
      {content}
    </pre>
  );
}
