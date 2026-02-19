"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateUserProfile } from "@/lib/hooks/use-profile";
import {
  COMMUNICATION_STYLE,
  COMMUNICATION_STYLE_CONFIG,
  type CommunicationStyle,
} from "@/lib/design-tokens";
import { toast } from "sonner";
import { SettingsRow } from "./SettingsRow";
import type { UserProfileWithWorkspaces } from "@/lib/types";

interface AIPreferencesSectionProps {
  profile: UserProfileWithWorkspaces;
}

export function AIPreferencesSection({ profile }: AIPreferencesSectionProps) {
  const [style, setStyle] = useState<CommunicationStyle | "">(
    (profile.aiCommunicationStyle as CommunicationStyle) ?? ""
  );
  const [instructions, setInstructions] = useState(
    profile.aiCustomInstructions ?? ""
  );
  const mutation = useUpdateUserProfile();

  const hasChanges =
    style !== ((profile.aiCommunicationStyle as CommunicationStyle) ?? "") ||
    instructions !== (profile.aiCustomInstructions ?? "");

  const handleSave = async () => {
    const result = await mutation.mutateAsync({
      aiCommunicationStyle: (style || null) as CommunicationStyle | null,
      aiCustomInstructions: instructions || null,
    });

    if (result.success) {
      toast.success("AI preferences updated");
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-foreground mb-3">
        AI Preferences
      </h3>
      <div className="rounded-lg border border-border bg-card">
        <SettingsRow
          label="Communication Style"
          description="How AI should communicate with you"
        >
          <Select
            value={style}
            onValueChange={(value) => setStyle(value as CommunicationStyle)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a style..." />
            </SelectTrigger>
            <SelectContent>
              {(
                Object.keys(COMMUNICATION_STYLE) as Array<
                  keyof typeof COMMUNICATION_STYLE
                >
              ).map((key) => {
                const value = COMMUNICATION_STYLE[key];
                const config = COMMUNICATION_STYLE_CONFIG[value];
                return (
                  <SelectItem key={value} value={value}>
                    <span>{config.label}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {config.description}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </SettingsRow>
        <div className="px-6 py-4">
          <div className="mb-2">
            <div className="text-sm font-medium text-foreground">Custom Instructions</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Additional context or rules for AI
            </div>
          </div>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Always respond in bullet points, prefer TypeScript examples..."
            className="min-h-[200px]"
          />
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || mutation.isPending}
        >
          {mutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
