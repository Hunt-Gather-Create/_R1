"use client";

import { useState } from "react";
import { Share2, Mail, Users, Newspaper, Check, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MARKETING_PROJECT_TYPES,
  type MarketingProjectType,
} from "@/lib/marketing-project-types";

const ICON_MAP: Record<string, LucideIcon> = {
  Share2,
  Mail,
  Users,
  Newspaper,
};

const PROJECT_TYPE_ENTRIES = (
  Object.entries(MARKETING_PROJECT_TYPES) as [MarketingProjectType, (typeof MARKETING_PROJECT_TYPES)[MarketingProjectType]][]
);

interface OnboardingProjectTypeProps {
  onSelect: (projectType: MarketingProjectType) => void;
  isLoading: boolean;
}

export function OnboardingProjectType({
  onSelect,
  isLoading,
}: OnboardingProjectTypeProps) {
  const [selected, setSelected] = useState<MarketingProjectType | null>(null);

  const handleContinue = () => {
    if (selected) {
      onSelect(selected);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold text-foreground">
          What type of project?
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a starting point for your workspace
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {PROJECT_TYPE_ENTRIES.map(([key, config]) => {
          const Icon = ICON_MAP[config.icon];
          const isSelected = selected === key;

          return (
            <button
              key={key}
              onClick={() => setSelected(key)}
              disabled={isLoading}
              className={`relative flex flex-col items-center gap-3 p-6 rounded-xl border text-center transition-all ${
                isSelected
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border/40 bg-card/50 hover:border-border/80 hover:shadow-lg hover:shadow-black/20"
              }`}
            >
              {isSelected && (
                <div className="absolute top-3 right-3">
                  <Check className="w-4 h-4 text-primary" />
                </div>
              )}
              <div
                className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                  isSelected
                    ? "bg-primary/10"
                    : "bg-orange-500/10"
                }`}
              >
                {Icon ? (
                  <Icon
                    className={`w-6 h-6 ${
                      isSelected ? "text-primary" : "text-orange-500"
                    }`}
                  />
                ) : null}
              </div>
              <div>
                <div className="font-medium text-foreground">{config.label}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {config.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex justify-center">
        <Button
          onClick={handleContinue}
          disabled={!selected || isLoading}
        >
          {isLoading ? "Setting up workspace..." : "Get Started"}
        </Button>
      </div>
    </div>
  );
}
