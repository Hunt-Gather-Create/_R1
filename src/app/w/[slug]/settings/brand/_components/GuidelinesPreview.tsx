"use client";

import type { BrandGuidelines } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EditableField, ListField, TagListField } from "@/components/ui/editable-field";

interface GuidelinesPreviewProps {
  guidelines: BrandGuidelines;
  onGuidelinesChange: (guidelines: BrandGuidelines) => void;
  onSave: () => void;
  isSaving: boolean;
}

export function GuidelinesPreview({
  guidelines,
  onGuidelinesChange,
  onSave,
  isSaving,
}: GuidelinesPreviewProps) {
  // Helper to update nested logo fields
  const updateLogo = (field: keyof NonNullable<BrandGuidelines["logo"]>, value: string | string[]) => {
    onGuidelinesChange({
      ...guidelines,
      logo: {
        ...guidelines.logo,
        [field]: value,
      },
    });
  };

  // Helper to update nested typography fields
  const updateTypography = (field: keyof NonNullable<BrandGuidelines["typography"]>, value: string) => {
    onGuidelinesChange({
      ...guidelines,
      typography: {
        ...guidelines.typography,
        [field]: value,
      },
    });
  };

  // Helper to update nested voiceAndTone fields
  const updateVoiceAndTone = (field: keyof NonNullable<BrandGuidelines["voiceAndTone"]>, value: string[]) => {
    onGuidelinesChange({
      ...guidelines,
      voiceAndTone: {
        ...guidelines.voiceAndTone,
        [field]: value,
      },
    });
  };

  // Helper to update nested imagery fields
  const updateImagery = (field: keyof NonNullable<BrandGuidelines["imagery"]>, value: string | string[]) => {
    onGuidelinesChange({
      ...guidelines,
      imagery: {
        ...guidelines.imagery,
        [field]: value,
      },
    });
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-8">
        {/* Summary */}
        <EditableField
          label="Summary"
          value={guidelines.summary || ""}
          onChange={(summary) => onGuidelinesChange({ ...guidelines, summary })}
          placeholder="Add a summary of the brand guidelines..."
          multiline
        />

        {/* Logo Usage */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground border-b border-border pb-2">
            Logo Usage
          </h3>

          <EditableField
            label="Clear Space"
            value={guidelines.logo?.clearSpace || ""}
            onChange={(value) => updateLogo("clearSpace", value)}
            placeholder="Describe logo clear space requirements..."
          />

          <EditableField
            label="Minimum Size"
            value={guidelines.logo?.minimumSize || ""}
            onChange={(value) => updateLogo("minimumSize", value)}
            placeholder="Specify minimum logo size..."
          />

          <ListField
            label="Logo Rules"
            items={guidelines.logo?.rules || []}
            onChange={(rules) => updateLogo("rules", rules)}
            placeholder="Add a logo usage rule..."
            emptyText="No logo rules defined yet."
          />
        </div>

        {/* Typography */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground border-b border-border pb-2">
            Typography
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <EditableField
              label="Primary Font"
              value={guidelines.typography?.primaryFont || ""}
              onChange={(value) => updateTypography("primaryFont", value)}
              placeholder="e.g., Inter, Roboto..."
            />

            <EditableField
              label="Secondary Font"
              value={guidelines.typography?.secondaryFont || ""}
              onChange={(value) => updateTypography("secondaryFont", value)}
              placeholder="e.g., Georgia, Merriweather..."
            />
          </div>
        </div>

        {/* Voice & Tone */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground border-b border-border pb-2">
            Voice & Tone
          </h3>

          <TagListField
            label="Brand Characteristics"
            items={guidelines.voiceAndTone?.characteristics || []}
            onChange={(characteristics) => updateVoiceAndTone("characteristics", characteristics)}
            placeholder="Add a characteristic..."
            emptyText="No characteristics defined yet."
          />

          <ListField
            label="Do's"
            items={guidelines.voiceAndTone?.doUse || []}
            onChange={(doUse) => updateVoiceAndTone("doUse", doUse)}
            placeholder="Add something to do..."
            emptyText="No do's defined yet."
            variant="success"
          />

          <ListField
            label="Don'ts"
            items={guidelines.voiceAndTone?.dontUse || []}
            onChange={(dontUse) => updateVoiceAndTone("dontUse", dontUse)}
            placeholder="Add something to avoid..."
            emptyText="No don'ts defined yet."
            variant="destructive"
          />
        </div>

        {/* Imagery */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground border-b border-border pb-2">
            Imagery
          </h3>

          <EditableField
            label="Style"
            value={guidelines.imagery?.style || ""}
            onChange={(value) => updateImagery("style", value)}
            placeholder="Describe the imagery style..."
            multiline
          />

          <ListField
            label="Image Guidelines"
            items={guidelines.imagery?.guidelines || []}
            onChange={(imageGuidelines) => updateImagery("guidelines", imageGuidelines)}
            placeholder="Add an image guideline..."
            emptyText="No image guidelines defined yet."
          />
        </div>

        {/* Sources (read-only) */}
        {guidelines.sources && guidelines.sources.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground border-b border-border pb-2">
              Sources
            </h3>
            <ul className="text-sm space-y-1">
              {guidelines.sources.map((source, i) => (
                <li key={i}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {source.title || source.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Save Button */}
        <div className="pt-6">
          <Button
            onClick={onSave}
            disabled={isSaving}
            className="w-full"
          >
            {isSaving ? "Saving..." : "Save Guidelines"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
