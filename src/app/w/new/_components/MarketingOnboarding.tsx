"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CreateBrandInput } from "@/lib/types";
import {
  createBrand,
  setWorkspaceBrand,
  getWorkspaceBrand,
} from "@/lib/actions/brand";
import { createAudience } from "@/lib/actions/audience";
import { generateSoulFromBrand } from "@/lib/actions/soul";
import { createStarterIssues } from "@/lib/actions/workspace";
import { useBrandSearch, type BrandSearchState } from "../_hooks/useBrandSearch";
import type { MarketingProjectType } from "@/lib/marketing-project-types";

// Dynamic imports for brand components (only needed for marketing flow)
const BrandSearchForm = dynamic(
  () =>
    import(
      "@/app/w/[slug]/settings/brand/_components/BrandSearchForm"
    ).then((mod) => mod.BrandSearchForm),
  { ssr: false }
);

const BrandDisambiguation = dynamic(
  () =>
    import(
      "@/app/w/[slug]/settings/brand/_components/BrandDisambiguation"
    ).then((mod) => mod.BrandDisambiguation),
  { ssr: false }
);

const BrandPreview = dynamic(
  () =>
    import(
      "@/app/w/[slug]/settings/brand/_components/BrandPreview"
    ).then((mod) => mod.BrandPreview),
  { ssr: false }
);

const BrandLoadingState = dynamic(
  () =>
    import(
      "@/app/w/[slug]/settings/brand/_components/BrandLoadingState"
    ).then((mod) => mod.BrandLoadingState),
  { ssr: false }
);

const OnboardingProjectType = dynamic(
  () =>
    import("./OnboardingProjectType").then((mod) => mod.OnboardingProjectType),
  { ssr: false }
);

type MarketingStep =
  | "brand-search"
  | "brand-searching"
  | "brand-disambiguation"
  | "brand-researching"
  | "brand-preview"
  | "brand-summary"
  | "audience"
  | "project-type";

const SEARCH_STATE_TO_STEP: Record<BrandSearchState, MarketingStep> = {
  idle: "brand-search",
  searching: "brand-searching",
  disambiguation: "brand-disambiguation",
  researching: "brand-researching",
  preview: "brand-preview",
};

interface MarketingOnboardingProps {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  onBack: () => void;
}

export function MarketingOnboarding({
  workspaceId,
  workspaceSlug,
  workspaceName,
  onBack,
}: MarketingOnboardingProps) {
  const router = useRouter();
  // Only tracks post-brand steps; brand-related steps are derived from searchState
  const [marketingStep, setMarketingStep] =
    useState<MarketingStep>("brand-search");
  const [brandId, setBrandId] = useState<string | null>(null);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [brandSummary, setBrandSummary] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    searchState,
    disambiguationResults,
    previewBrand,
    error: searchError,
    handleSearch,
    handleDisambiguationSelect,
    handleCreateFromScratch,
  } = useBrandSearch();

  // Derive the current step: post-brand steps from local state, brand steps from search hook
  const isPostBrandStep =
    marketingStep === "brand-summary" ||
    marketingStep === "audience" ||
    marketingStep === "project-type";
  const currentStep: MarketingStep = isPostBrandStep
    ? marketingStep
    : SEARCH_STATE_TO_STEP[searchState];

  // Combine errors from both sources
  const displayError = error || searchError;

  // Poll for brand summary once brand is saved
  useEffect(() => {
    if (currentStep !== "brand-summary" || !brandId || brandSummary) return;

    const pollInterval = setInterval(async () => {
      try {
        const brand = await getWorkspaceBrand(workspaceId);
        if (brand?.summary) {
          setBrandSummary(brand.summary);
          clearInterval(pollInterval);
        }
      } catch {
        // Silently retry
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [currentStep, brandId, workspaceId, brandSummary]);

  // Create audience and advance to project-type step
  const advanceToAudience = useCallback(
    async (
      currentBrandId: string,
      currentBrandName: string,
      currentBrandSummary: string | null
    ) => {
      setMarketingStep("audience");

      try {
        const summaryContext = currentBrandSummary
          ? `Based on the brand: ${currentBrandSummary}`
          : `For the brand "${currentBrandName}"`;

        await createAudience({
          workspaceId,
          name: `${currentBrandName} Target Audience`,
          description: `Auto-generated target audience for ${currentBrandName}`,
          generationPrompt: `${summaryContext}, generate diverse audience member personas that represent the target customers. Include a mix of demographics, psychographics, and behavioral traits that are most relevant for this brand's marketing efforts.`,
        });
      } catch (err) {
        console.error("Audience creation error:", err);
        // Don't block the flow - advance anyway
      }

      setMarketingStep("project-type");
    },
    [workspaceId]
  );

  // Handle saving brand from preview, linking to workspace, then advancing
  const handleSaveBrand = useCallback(
    async (data: CreateBrandInput) => {
      setIsActionLoading(true);
      setError(null);

      try {
        const newBrand = await createBrand(data);
        await setWorkspaceBrand(workspaceId, newBrand.id);

        setBrandId(newBrand.id);
        setBrandName(newBrand.name);

        // If brand has a website, go to summary step (summary will be generated)
        // Otherwise skip directly to audience creation
        if (newBrand.websiteUrl) {
          setMarketingStep("brand-summary");
        } else {
          await advanceToAudience(newBrand.id, newBrand.name, null);
        }
      } catch (err) {
        console.error("Save brand error:", err);
        setError("Failed to save brand. Please try again.");
      } finally {
        setIsActionLoading(false);
      }
    },
    [workspaceId, advanceToAudience]
  );

  // Advance from summary to audience auto-creation
  const handleSummaryAdvance = () => {
    if (brandId && brandName) {
      advanceToAudience(brandId, brandName, brandSummary);
    }
  };

  // Handle project type selection
  const handleProjectTypeSelect = useCallback(
    async (projectType: MarketingProjectType) => {
      setIsActionLoading(true);
      setError(null);

      try {
        // Fire-and-forget soul generation + create starter issues in parallel
        await Promise.all([
          generateSoulFromBrand(workspaceId, projectType),
          createStarterIssues(workspaceId, projectType),
        ]);

        router.push(`/w/${workspaceSlug}`);
      } catch (err) {
        console.error("Project setup error:", err);
        // Even on error, redirect - the workspace exists and is usable
        router.push(`/w/${workspaceSlug}`);
      }
    },
    [workspaceId, workspaceSlug, router]
  );

  const handleBack = () => {
    setError(null);
    switch (currentStep) {
      case "brand-search":
        onBack();
        break;
      case "brand-searching":
      case "brand-disambiguation":
        setMarketingStep("brand-search");
        break;
      case "brand-researching":
        setMarketingStep("brand-disambiguation");
        break;
      case "brand-preview":
        setMarketingStep("brand-search");
        break;
      case "brand-summary":
      case "audience":
      case "project-type":
        // Can't go back after brand is saved
        break;
    }
  };

  const canGoBack =
    currentStep === "brand-search" ||
    currentStep === "brand-searching" ||
    currentStep === "brand-disambiguation" ||
    currentStep === "brand-researching" ||
    currentStep === "brand-preview";

  const getStepLabel = () => {
    switch (currentStep) {
      case "brand-search":
      case "brand-searching":
      case "brand-disambiguation":
      case "brand-researching":
      case "brand-preview":
        return "Set up your brand";
      case "brand-summary":
        return "Brand summary";
      case "audience":
        return "Creating your audience";
      case "project-type":
        return "Choose your focus";
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 h-12 px-4 border-b border-border shrink-0">
        {canGoBack && (
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        )}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{workspaceName}</span>
          <span className="text-xs text-muted-foreground">
            / {getStepLabel()}
          </span>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div
          className="flex items-center justify-center min-h-full"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(249, 115, 22, 0.1), transparent)",
          }}
        >
          <div className="w-full max-w-2xl p-8">
            {/* Error display */}
            {displayError && (
              <div className="mb-6 text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-md border border-destructive/20">
                {displayError}
              </div>
            )}

            {/* Brand Search */}
            {currentStep === "brand-search" && (
              <div>
                <div className="text-center mb-8">
                  <h2 className="text-xl font-semibold text-foreground">
                    Find your brand
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Search by name or enter your website URL
                  </p>
                </div>
                <BrandSearchForm onSearch={handleSearch} isLoading={false} />
              </div>
            )}

            {/* Searching */}
            {currentStep === "brand-searching" && (
              <BrandLoadingState message="Searching for brand..." />
            )}

            {/* Disambiguation */}
            {currentStep === "brand-disambiguation" && (
              <BrandDisambiguation
                results={disambiguationResults}
                onSelect={handleDisambiguationSelect}
                onCreateFromScratch={handleCreateFromScratch}
                isLoading={false}
              />
            )}

            {/* Researching */}
            {currentStep === "brand-researching" && (
              <BrandLoadingState message="Researching brand details..." />
            )}

            {/* Brand Preview */}
            {currentStep === "brand-preview" && (
              <BrandPreview
                brand={previewBrand}
                onSave={handleSaveBrand}
                onCancel={() => setMarketingStep("brand-search")}
                isLoading={isActionLoading}
              />
            )}

            {/* Brand Summary */}
            {currentStep === "brand-summary" && (
              <div>
                <h2 className="text-xl font-semibold text-foreground mb-4">
                  Brand Summary
                </h2>
                {brandSummary ? (
                  <>
                    <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
                      {brandSummary}
                    </p>
                    <div className="flex justify-end">
                      <Button onClick={handleSummaryAdvance}>Continue</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col items-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                      <p className="text-sm text-muted-foreground">
                        Generating brand summary...
                      </p>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSummaryAdvance}
                      >
                        Skip
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Audience Auto-Creation */}
            {currentStep === "audience" && (
              <div className="flex flex-col items-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <h2 className="text-xl font-semibold text-foreground mb-1">
                  Creating your target audience
                </h2>
                <p className="text-sm text-muted-foreground">
                  Building audience personas based on your brand...
                </p>
              </div>
            )}

            {/* Project Type Selection */}
            {currentStep === "project-type" && (
              <OnboardingProjectType
                onSelect={handleProjectTypeSelect}
                isLoading={isActionLoading}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
