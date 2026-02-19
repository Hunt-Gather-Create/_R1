"use client";

import { useState } from "react";
import { Pencil, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DescriptionEditorDialog } from "@/components/issues/DescriptionEditorDialog";
import { Button } from "@/components/ui/button";
import { LexicalMarkdownPreview } from "@/components/ui/lexical";
import { useUploadImage } from "@/lib/hooks";

interface BrandSummaryFieldProps {
  brandId: string;
  workspaceId: string;
  value: string;
  onChange: (value: string) => void;
  onSave: (value?: string) => void;
  isSaving?: boolean;
  isBackgroundGenerating?: boolean;
}

export function BrandSummaryField({
  brandId,
  workspaceId,
  value,
  onChange,
  onSave,
  isSaving = false,
  isBackgroundGenerating = false,
}: BrandSummaryFieldProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadImage = useUploadImage(workspaceId);

  const handleClose = () => {
    onSave();
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/brand/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to generate summary");
      }

      const data = await response.json();
      onChange(data.summary);
      // Auto-save after generation, passing value directly to avoid state timing issues
      onSave(data.summary);
    } catch (err) {
      console.error("Generate summary error:", err);
      setError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setIsGenerating(false);
    }
  };

  const isDisabled = isSaving || isGenerating || isBackgroundGenerating;

  // Show background generation state
  if (isBackgroundGenerating) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground">
            Summary
          </label>
        </div>
        <div className="min-h-[80px] rounded-md border border-border bg-muted/30 flex flex-col items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Generating AI summary...</p>
          <p className="text-xs text-muted-foreground mt-1">This may take a moment</p>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          A short summary used as context for AI agents working on this brand.
        </p>
      </div>
    );
  }

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground">
            Summary
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGenerate}
            disabled={isDisabled}
            className="h-7 text-xs gap-1.5"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                {value ? "Regenerate" : "Generate"}
              </>
            )}
          </Button>
        </div>
        <div
          onClick={() => !isDisabled && setIsDialogOpen(true)}
          className={cn(
            "min-h-[80px] max-h-[200px] overflow-y-auto rounded-md border border-border bg-muted/30 cursor-text group relative",
            "hover:border-muted-foreground/50 transition-colors scrollbar-thin",
            isDisabled && "opacity-50 cursor-not-allowed"
          )}
        >
          {value ? (
            <div className="p-3">
              <LexicalMarkdownPreview content={value} />
            </div>
          ) : (
            <div className="p-3 text-muted-foreground text-sm">
              Click to add a summary or use the Generate button...
            </div>
          )}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="p-1.5 bg-muted rounded-md">
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>
        </div>
        {error && (
          <p className="text-xs text-destructive mt-1">{error}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          A short summary used as context for AI agents working on this brand.
        </p>
      </div>

      <DescriptionEditorDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        value={value}
        onChange={onChange}
        onClose={handleClose}
        placeholder="Write a 1-3 sentence summary of what the brand does, their target audience, and value proposition..."
        onUploadImage={uploadImage}
      />
    </>
  );
}
