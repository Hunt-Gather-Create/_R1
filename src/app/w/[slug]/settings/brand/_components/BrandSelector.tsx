"use client";

import Image from "next/image";
import { Globe, Plus, Check } from "lucide-react";
import type { Brand } from "@/lib/types";

interface BrandSelectorProps {
  brands: Brand[];
  selectedBrandId: string | null;
  onSelect: (brand: Brand) => void;
  onCreateNew: () => void;
}

export function BrandSelector({
  brands,
  selectedBrandId,
  onSelect,
  onCreateNew,
}: BrandSelectorProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <h3 className="text-lg font-medium text-foreground mb-2 text-center">
        Select a brand
      </h3>
      <p className="text-sm text-muted-foreground mb-6 text-center">
        Choose an existing brand or create a new one
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {brands.map((brand) => (
          <button
            key={brand.id}
            onClick={() => onSelect(brand)}
            className={`p-4 rounded-lg border text-left transition-colors ${
              selectedBrandId === brand.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-accent/50"
            }`}
          >
            <div className="flex flex-col items-center text-center">
              {brand.logoUrl ? (
                <Image
                  src={brand.logoUrl}
                  alt={brand.name}
                  width={64}
                  height={64}
                  className="w-16 h-16 rounded object-contain bg-white mb-3"
                  unoptimized
                />
              ) : (
                <div className="w-16 h-16 rounded bg-muted flex items-center justify-center mb-3">
                  {brand.primaryColor ? (
                    <div
                      className="w-10 h-10 rounded"
                      style={{ backgroundColor: brand.primaryColor }}
                    />
                  ) : (
                    <Globe className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-foreground">{brand.name}</h4>
                {selectedBrandId === brand.id && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </div>
              {brand.tagline && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                  {brand.tagline}
                </p>
              )}
            </div>
          </button>
        ))}

        {/* Create new brand card */}
        <button
          onClick={onCreateNew}
          className="p-4 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-accent/50 transition-colors"
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded bg-muted flex items-center justify-center mb-3">
              <Plus className="w-8 h-8 text-muted-foreground" />
            </div>
            <h4 className="font-medium text-foreground">Create New Brand</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Research and add a new brand
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
