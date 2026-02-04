"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, RefreshCw, X, Plus } from "lucide-react";
import { createAudience } from "@/lib/actions/audience";
import type { Audience } from "@/lib/types";
import type { SuggestedDemographic } from "@/lib/schemas/audience-member";

interface CreateAudienceDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (audience: Audience) => void;
}

export function CreateAudienceDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: CreateAudienceDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [traits, setTraits] = useState<string[]>([]);
  const [newTrait, setNewTrait] = useState("");

  const [isLoadingSuggestion, setIsLoadingSuggestion] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  // Load AI suggestion when dialog opens
  useEffect(() => {
    if (open) {
      loadSuggestion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const loadSuggestion = async () => {
    setIsLoadingSuggestion(true);
    setSuggestionError(null);

    try {
      const response = await fetch("/api/audience/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });

      if (!response.ok) {
        // Try to get error details from response
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.error("Suggestion API error:", errorData);
        setSuggestionError(errorData.error || "Failed to generate suggestion");
        // Don't block the user - they can fill in manually
        return;
      }

      const suggestion: SuggestedDemographic = await response.json();

      setName(suggestion.suggestedName);
      setDescription(suggestion.suggestedDescription || "");
      setGenerationPrompt(suggestion.suggestedDemographic);
      setTraits(suggestion.suggestedTraits);
    } catch (err) {
      console.error("Failed to load suggestion:", err);
      setSuggestionError("Failed to connect to server");
      // Don't block the user - they can still fill manually
    } finally {
      setIsLoadingSuggestion(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !generationPrompt.trim()) {
      setError("Name and demographic description are required");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const audience = await createAudience({
        workspaceId,
        name: name.trim(),
        description: description.trim() || undefined,
        generationPrompt: generationPrompt.trim(),
      });

      onCreated(audience);

      // Reset form
      setName("");
      setDescription("");
      setGenerationPrompt("");
      setTraits([]);
      setNewTrait("");
    } catch (err) {
      console.error("Failed to create audience:", err);
      setError(
        err instanceof Error ? err.message : "Failed to create audience"
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      onOpenChange(false);
      setName("");
      setDescription("");
      setGenerationPrompt("");
      setTraits([]);
      setNewTrait("");
      setError(null);
      setSuggestionError(null);
    }
  };

  const handleRemoveTrait = (traitToRemove: string) => {
    setTraits((prev) => prev.filter((t) => t !== traitToRemove));
  };

  const handleAddTrait = () => {
    const trimmed = newTrait.trim();
    if (trimmed && !traits.includes(trimmed)) {
      setTraits((prev) => [...prev, trimmed]);
      setNewTrait("");
    }
  };

  const handleTraitKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTrait();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Create Audience</DialogTitle>
            <DialogDescription>
              Generate AI-powered audience personas based on your target
              demographic. We&apos;ll create 10 diverse, realistic personas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 overflow-y-auto flex-1 min-h-0">
            {/* Full-screen loading state while generating suggestion */}
            {isLoadingSuggestion ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-primary animate-pulse" />
                  </div>
                  <div className="absolute inset-0 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                </div>
                <div className="text-center space-y-1">
                  <p className="font-medium">Analyzing your brand...</p>
                  <p className="text-sm text-muted-foreground">
                    AI is generating a suggested target demographic
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Suggestion error (non-blocking) */}
                {suggestionError && (
                  <div className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-md">
                    Could not generate suggestion: {suggestionError}. You can still fill in the form manually.
                  </div>
                )}

                {/* Name */}
                <div className="grid gap-2">
                  <Label htmlFor="name">Audience Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Young Professionals"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isCreating}
                  />
                </div>

                {/* Description (optional) */}
                <div className="grid gap-2">
                  <Label htmlFor="description">
                    Description{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="description"
                    placeholder="Brief description of this audience segment"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isCreating}
                  />
                </div>

                {/* Generation Prompt */}
                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="generationPrompt">Target Demographic</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={loadSuggestion}
                      disabled={isCreating}
                      className="h-6 px-2 text-xs"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Regenerate
                    </Button>
                  </div>
                  <Textarea
                    id="generationPrompt"
                    placeholder="Describe your target audience in detail. Include age range, interests, behaviors, and any specific characteristics."
                    value={generationPrompt}
                    onChange={(e) => setGenerationPrompt(e.target.value)}
                    disabled={isCreating}
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Be specific about demographics, interests, and behaviors for
                    more accurate personas.
                  </p>
                </div>

                {/* Key Traits */}
                <div className="grid gap-2">
                  <Label>Key Traits</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a trait..."
                      value={newTrait}
                      onChange={(e) => setNewTrait(e.target.value)}
                      onKeyDown={handleTraitKeyDown}
                      disabled={isCreating}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddTrait}
                      disabled={isCreating || !newTrait.trim()}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {traits.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {traits.map((trait) => (
                        <Badge
                          key={trait}
                          variant="secondary"
                          className="text-xs pr-1 flex items-center gap-1"
                        >
                          {trait}
                          <button
                            type="button"
                            onClick={() => handleRemoveTrait(trait)}
                            disabled={isCreating}
                            className="hover:bg-muted-foreground/20 rounded-full p-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Add traits that define this audience. Press Enter or click + to add.
                  </p>
                </div>

                {/* Error */}
                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                    {error}
                  </div>
                )}
              </>
            )}
          </div>

          {!isLoadingSuggestion && (
            <DialogFooter className="flex-shrink-0 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Audience"
                )}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
