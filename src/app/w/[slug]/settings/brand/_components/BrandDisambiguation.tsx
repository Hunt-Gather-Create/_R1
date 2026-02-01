"use client";

import { useState } from "react";
import Image from "next/image";
import { Globe, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BrandSearchResult } from "@/lib/types";

interface BrandDisambiguationProps {
  results: BrandSearchResult[];
  onSelect: (result: BrandSearchResult) => void;
  onCreateFromScratch: () => void;
  isLoading: boolean;
}

export function BrandDisambiguation({
  results,
  onSelect,
  onCreateFromScratch,
  isLoading,
}: BrandDisambiguationProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | "scratch" | null>(null);

  const handleContinue = () => {
    if (selectedIndex === "scratch") {
      onCreateFromScratch();
    } else if (selectedIndex !== null && results[selectedIndex]) {
      onSelect(results[selectedIndex]);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h3 className="text-lg font-medium text-foreground mb-2 text-center">
        Which brand do you mean?
      </h3>
      <p className="text-sm text-muted-foreground mb-6 text-center">
        We found multiple brands matching your search. Please select one.
      </p>

      <div className="space-y-3">
        {results.map((result, index) => (
          <button
            key={index}
            onClick={() => setSelectedIndex(index)}
            className={`w-full p-4 rounded-lg border text-left transition-colors ${
              selectedIndex === index
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-accent/50"
            }`}
            disabled={isLoading}
          >
            <div className="flex items-start gap-4">
              {result.logoUrl ? (
                <Image
                  src={result.logoUrl}
                  alt={result.name}
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded object-contain bg-white"
                  unoptimized
                />
              ) : (
                <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
                  <Globe className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-foreground">{result.name}</h4>
                  {selectedIndex === index && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                  {result.description}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {result.websiteUrl}
                </p>
              </div>
            </div>
          </button>
        ))}

        {/* Create from scratch option */}
        <button
          onClick={() => setSelectedIndex("scratch")}
          className={`w-full p-4 rounded-lg border text-left transition-colors ${
            selectedIndex === "scratch"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-accent/50"
          }`}
          disabled={isLoading}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
              <Plus className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-foreground">Create from scratch</h4>
                {selectedIndex === "scratch" && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Enter brand details manually
              </p>
            </div>
          </div>
        </button>
      </div>

      <div className="mt-6 flex justify-center">
        <Button
          onClick={handleContinue}
          disabled={selectedIndex === null || isLoading}
        >
          {isLoading ? "Loading..." : "Continue"}
        </Button>
      </div>
    </div>
  );
}
