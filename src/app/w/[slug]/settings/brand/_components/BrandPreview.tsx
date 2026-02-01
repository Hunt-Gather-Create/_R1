"use client";

import { useState } from "react";
import Image from "next/image";
import { Globe, Palette, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Brand, CreateBrandInput } from "@/lib/types";

interface BrandPreviewProps {
  brand: Partial<Brand> | null;
  onSave: (data: CreateBrandInput) => void;
  onCancel: () => void;
  isLoading: boolean;
  isNewBrand?: boolean;
}

export function BrandPreview({
  brand,
  onSave,
  onCancel,
  isLoading,
  isNewBrand = true,
}: BrandPreviewProps) {
  const [formData, setFormData] = useState<CreateBrandInput>({
    name: brand?.name ?? "",
    tagline: brand?.tagline ?? "",
    description: brand?.description ?? "",
    logoUrl: brand?.logoUrl ?? "",
    websiteUrl: brand?.websiteUrl ?? "",
    primaryColor: brand?.primaryColor ?? "#3b82f6",
    secondaryColor: brand?.secondaryColor ?? "#10b981",
    industry: brand?.industry ?? "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    onSave(formData);
  };

  const handleChange = (
    field: keyof CreateBrandInput,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h3 className="text-lg font-medium text-foreground mb-2 text-center">
        {isNewBrand ? "Review Brand Details" : "Edit Brand"}
      </h3>
      <p className="text-sm text-muted-foreground mb-6 text-center">
        {isNewBrand
          ? "Review and edit the brand information before saving"
          : "Update the brand details"}
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Logo Preview */}
        <div className="flex justify-center">
          {formData.logoUrl ? (
            <div
              className="w-24 h-24 rounded-lg flex items-center justify-center p-2 border border-border"
              style={{
                // Use analyzed background if available, otherwise default to white
                backgroundColor: brand?.logoBackground === "dark" ? "#1f2937" : "#ffffff",
              }}
            >
              <Image
                src={formData.logoUrl}
                alt={formData.name}
                width={80}
                height={80}
                className="max-w-full max-h-full object-contain"
                unoptimized
              />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-lg bg-muted flex items-center justify-center border border-border">
              <Globe className="w-10 h-10 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Logo URL */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Logo URL
          </label>
          <Input
            type="url"
            value={formData.logoUrl}
            onChange={(e) => handleChange("logoUrl", e.target.value)}
            placeholder="https://example.com/logo.png"
            disabled={isLoading}
          />
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Brand Name <span className="text-destructive">*</span>
          </label>
          <Input
            type="text"
            value={formData.name}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder="Acme Inc."
            disabled={isLoading}
            required
          />
        </div>

        {/* Tagline */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Tagline
          </label>
          <Input
            type="text"
            value={formData.tagline}
            onChange={(e) => handleChange("tagline", e.target.value)}
            placeholder="Making the world a better place"
            disabled={isLoading}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Description
          </label>
          <Textarea
            value={formData.description}
            onChange={(e) => handleChange("description", e.target.value)}
            placeholder="A brief description of the brand..."
            rows={3}
            disabled={isLoading}
          />
        </div>

        {/* Website URL */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Website URL
          </label>
          <Input
            type="url"
            value={formData.websiteUrl}
            onChange={(e) => handleChange("websiteUrl", e.target.value)}
            placeholder="https://example.com"
            disabled={isLoading}
          />
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              <span className="flex items-center gap-2">
                <Palette className="w-4 h-4" />
                Primary Color
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="color"
                value={formData.primaryColor}
                onChange={(e) => handleChange("primaryColor", e.target.value)}
                className="w-9 h-9 rounded-md border border-input cursor-pointer bg-transparent"
                disabled={isLoading}
              />
              <Input
                type="text"
                value={formData.primaryColor}
                onChange={(e) => handleChange("primaryColor", e.target.value)}
                placeholder="#3b82f6"
                className="flex-1 font-mono"
                disabled={isLoading}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              <span className="flex items-center gap-2">
                <Palette className="w-4 h-4" />
                Secondary Color
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="color"
                value={formData.secondaryColor}
                onChange={(e) => handleChange("secondaryColor", e.target.value)}
                className="w-9 h-9 rounded-md border border-input cursor-pointer bg-transparent"
                disabled={isLoading}
              />
              <Input
                type="text"
                value={formData.secondaryColor}
                onChange={(e) => handleChange("secondaryColor", e.target.value)}
                placeholder="#10b981"
                className="flex-1 font-mono"
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        {/* Industry */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            <span className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Industry
            </span>
          </label>
          <Input
            type="text"
            value={formData.industry}
            onChange={(e) => handleChange("industry", e.target.value)}
            placeholder="Technology, Healthcare, Retail, etc."
            disabled={isLoading}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-center gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!formData.name.trim() || isLoading}
          >
            {isLoading ? "Saving..." : "Save Brand"}
          </Button>
        </div>
      </form>
    </div>
  );
}
