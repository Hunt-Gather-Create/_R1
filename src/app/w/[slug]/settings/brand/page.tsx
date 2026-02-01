"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import { useSettingsContext } from "../context";
import { BrandLoadingState } from "./_components/BrandLoadingState";

// Dynamic imports for heavy components - only loaded based on page state
const BrandSearchForm = dynamic(
  () =>
    import("./_components/BrandSearchForm").then((mod) => mod.BrandSearchForm),
  { ssr: false }
);

const BrandDisambiguation = dynamic(
  () =>
    import("./_components/BrandDisambiguation").then(
      (mod) => mod.BrandDisambiguation
    ),
  { ssr: false }
);

const BrandPreview = dynamic(
  () => import("./_components/BrandPreview").then((mod) => mod.BrandPreview),
  { ssr: false }
);

const GuidelinesPreview = dynamic(
  () => import("./_components/GuidelinesPreview").then((mod) => mod.GuidelinesPreview),
  { ssr: false }
);

import {
  getWorkspaceBrand,
  createBrand,
  setWorkspaceBrand as linkWorkspaceBrand,
  unlinkWorkspaceBrand,
  updateBrandGuidelines,
  type BrandWithLogoUrl,
} from "@/lib/actions/brand";
import type { Brand, BrandSearchResult, CreateBrandInput, BrandGuidelines, GuidelinesStatus } from "@/lib/types";
import { Globe, Pencil, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";

type PageState =
  | "loading"
  | "empty"
  | "search"
  | "searching"
  | "disambiguation"
  | "researching"
  | "preview"
  | "linked";

export default function BrandSettingsPage() {
  const { workspace, currentUserId } = useSettingsContext();
  const [state, setState] = useState<PageState>("loading");
  const [workspaceBrand, setWorkspaceBrandState] =
    useState<BrandWithLogoUrl | null>(null);
  const [disambiguationResults, setDisambiguationResults] = useState<
    BrandSearchResult[]
  >([]);
  const [previewBrand, setPreviewBrand] = useState<Partial<Brand> | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [editedGuidelines, setEditedGuidelines] = useState<BrandGuidelines | null>(null);
  const [isSavingGuidelines, setIsSavingGuidelines] = useState(false);

  // Parse guidelines from brand
  const parseGuidelines = useCallback((brand: BrandWithLogoUrl): BrandGuidelines | null => {
    if (!brand.guidelines) return null;
    try {
      return JSON.parse(brand.guidelines) as BrandGuidelines;
    } catch {
      return null;
    }
  }, []);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      if (!currentUserId || !workspace?.id) return;

      try {
        const wsBrand = await getWorkspaceBrand(workspace.id);
        setWorkspaceBrandState(wsBrand);
        setState(wsBrand ? "linked" : "empty");
      } catch (err) {
        console.error("Failed to load brand data:", err);
        setError("Failed to load brand data");
        setState("empty");
      }
    }

    loadData();
  }, [currentUserId, workspace?.id]);

  // Initialize editedGuidelines when guidelines change or tab switches
  useEffect(() => {
    if (activeTab === "guidelines" && workspaceBrand) {
      const guidelines = parseGuidelines(workspaceBrand);
      if (guidelines) {
        setEditedGuidelines(guidelines);
      } else {
        // Initialize with empty guidelines structure
        setEditedGuidelines({
          lastUpdated: new Date().toISOString(),
          confidence: "low",
        });
      }
    }
  }, [activeTab, workspaceBrand, parseGuidelines]);

  // Poll for guidelines updates when on the guidelines tab and status is pending/processing
  useEffect(() => {
    if (activeTab !== "guidelines" || !workspace?.id || !workspaceBrand) return;

    const guidelinesStatus = workspaceBrand.guidelinesStatus as GuidelinesStatus | null;

    // Only poll if status is null, pending, or processing
    if (guidelinesStatus && guidelinesStatus !== "pending" && guidelinesStatus !== "processing") {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const updatedBrand = await getWorkspaceBrand(workspace.id);
        if (updatedBrand) {
          setWorkspaceBrandState(updatedBrand);

          // Stop polling if status changed to completed, failed, or not_found
          const newStatus = updatedBrand.guidelinesStatus as GuidelinesStatus | null;
          if (newStatus && newStatus !== "pending" && newStatus !== "processing") {
            clearInterval(pollInterval);
          }
        }
      } catch (err) {
        console.error("Failed to poll brand data:", err);
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [activeTab, workspace?.id, workspaceBrand]);

  // Handle disambiguation selection (defined first since handleSearch uses it)
  const handleDisambiguationSelect = useCallback(
    async (result: BrandSearchResult) => {
      setState("researching");
      setError(null);

      try {
        const response = await fetch("/api/brand/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "selection", selection: result }),
        });

        if (!response.ok) {
          throw new Error("Research failed");
        }

        const data = await response.json();

        if (data.brand) {
          setPreviewBrand(data.brand);
          setState("preview");
        } else {
          setError("Failed to get brand details");
          setState("disambiguation");
        }
      } catch (err) {
        console.error("Research error:", err);
        setError("Failed to research brand. Please try again.");
        setState("disambiguation");
      }
    },
    []
  );

  // Handle search (name or URL)
  const handleSearch = useCallback(
    async (query: string, type: "name" | "url") => {
      setState("searching");
      setError(null);

      try {
        const response = await fetch("/api/brand/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, type }),
        });

        if (!response.ok) {
          throw new Error("Research failed");
        }

        const data = await response.json();

        if (data.needsDisambiguation && data.results?.length > 1) {
          // Multiple results - let user choose
          setDisambiguationResults(data.results);
          setState("disambiguation");
        } else if (data.brand) {
          // URL or selection search returned full brand details
          setPreviewBrand(data.brand);
          setState("preview");
        } else if (data.results?.length === 1) {
          // Name search found exactly one result - auto-research it for full details
          const result = data.results[0];
          handleDisambiguationSelect(result);
        } else if (data.results?.length > 0) {
          // Multiple results without disambiguation flag - show selection UI
          setDisambiguationResults(data.results);
          setState("disambiguation");
        } else {
          setError("No results found");
          setState("search");
        }
      } catch (err) {
        console.error("Search error:", err);
        setError("Failed to research brand. Please try again.");
        setState("search");
      }
    },
    [handleDisambiguationSelect]
  );

  // Handle create from scratch
  const handleCreateFromScratch = useCallback(() => {
    setPreviewBrand({});
    setState("preview");
  }, []);

  // Handle save brand
  const handleSaveBrand = useCallback(
    async (data: CreateBrandInput) => {
      if (!workspace?.id) return;

      setIsActionLoading(true);
      setError(null);

      try {
        const newBrand = await createBrand(data);
        await linkWorkspaceBrand(workspace.id, newBrand.id);

        // Reload the brand to get resolved logo URL
        const linkedBrand = await getWorkspaceBrand(workspace.id);
        setWorkspaceBrandState(linkedBrand);
        setState("linked");
      } catch (err) {
        console.error("Save error:", err);
        setError("Failed to save brand. Please try again.");
      } finally {
        setIsActionLoading(false);
      }
    },
    [workspace?.id]
  );

  // Handle remove brand
  const handleRemoveBrand = useCallback(async () => {
    if (!workspace?.id) return;

    setIsActionLoading(true);
    setError(null);

    try {
      await unlinkWorkspaceBrand(workspace.id);
      setWorkspaceBrandState(null);
      setState("empty");
    } catch (err) {
      console.error("Remove error:", err);
      setError("Failed to remove brand. Please try again.");
    } finally {
      setIsActionLoading(false);
    }
  }, [workspace?.id]);

  // Handle edit brand (go back to preview with current data)
  const handleEditBrand = useCallback(() => {
    if (workspaceBrand) {
      setPreviewBrand(workspaceBrand);
      setState("preview");
    }
  }, [workspaceBrand]);

  // Handle save guidelines
  const handleSaveGuidelines = useCallback(async () => {
    if (!workspaceBrand || !editedGuidelines) return;

    setIsSavingGuidelines(true);
    setError(null);

    try {
      await updateBrandGuidelines(workspaceBrand.id, editedGuidelines);

      // Reload the brand to get updated data
      if (workspace?.id) {
        const updatedBrand = await getWorkspaceBrand(workspace.id);
        setWorkspaceBrandState(updatedBrand);
      }
    } catch (err) {
      console.error("Save guidelines error:", err);
      setError("Failed to save guidelines. Please try again.");
    } finally {
      setIsSavingGuidelines(false);
    }
  }, [workspaceBrand, editedGuidelines, workspace?.id]);

  // Render the brand detail view (linked state)
  const renderBrandDetail = () => {
    if (!workspaceBrand) return null;

    const primaryColor = workspaceBrand.primaryColor || "#3b82f6";
    const guidelinesStatus = workspaceBrand.guidelinesStatus as GuidelinesStatus | null;

    return (
      <GradientPage
        color={primaryColor}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleEditBrand}
              disabled={isActionLoading}
              className="bg-background/50 hover:bg-background/80"
              title="Edit brand"
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleRemoveBrand}
              disabled={isActionLoading}
              className="bg-background/50 hover:bg-destructive/80 hover:text-destructive-foreground"
              title="Remove brand"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </>
        }
      >
        <PageHeader
          label="Brand"
          title={workspaceBrand.name}
          subtitle={workspaceBrand.tagline ?? undefined}
        >
          {/* Logo and description */}
          <div className="flex gap-6 mt-6">
            {workspaceBrand.resolvedLogoUrl ? (
              <div
                className="w-32 h-32 rounded-lg flex items-center justify-center p-2 shrink-0"
                style={{
                  backgroundColor:
                    workspaceBrand.logoBackground === "dark"
                      ? "#1f2937"
                      : "#ffffff",
                }}
              >
                <Image
                  src={workspaceBrand.resolvedLogoUrl}
                  alt={workspaceBrand.name}
                  width={112}
                  height={112}
                  className="max-w-full max-h-full object-contain"
                  unoptimized
                />
              </div>
            ) : (
              <div
                className="w-32 h-32 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: primaryColor }}
              >
                <Globe className="w-12 h-12 text-white/80" />
              </div>
            )}

            {workspaceBrand.description && (
              <p className="text-foreground/80 leading-relaxed max-w-2xl">
                {workspaceBrand.description}
              </p>
            )}
          </div>
        </PageHeader>

        {/* Tabs */}
        <section id="brand-tabs" className="container">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="guidelines">
                Brand Guidelines
                {(!guidelinesStatus || guidelinesStatus === "processing" || guidelinesStatus === "pending") && (
                  <Loader2 className="ml-1.5 h-3 w-3 animate-spin" />
                )}
              </TabsTrigger>
              <TabsTrigger value="audience" disabled>
                Audience
              </TabsTrigger>
              <TabsTrigger value="tone" disabled>
                Tone & Style
              </TabsTrigger>
              <TabsTrigger value="competitors" disabled>
                Competitors
              </TabsTrigger>
              <TabsTrigger value="files" disabled>
                Files
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <Card>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Website */}
                    {workspaceBrand.websiteUrl && (
                      <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-1">
                          Website
                        </h3>
                        <a
                          href={workspaceBrand.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {workspaceBrand.websiteUrl}
                        </a>
                      </div>
                    )}

                    {/* Industry */}
                    {workspaceBrand.industry && (
                      <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-1">
                          Industry
                        </h3>
                        <p className="text-foreground">{workspaceBrand.industry}</p>
                      </div>
                    )}

                    {/* Colors */}
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">
                        Brand Colors
                      </h3>
                      <div className="flex gap-3">
                        {workspaceBrand.primaryColor && (
                          <div className="flex items-center gap-2">
                            <div
                              className="w-8 h-8 rounded-lg border border-border"
                              style={{
                                backgroundColor: workspaceBrand.primaryColor,
                              }}
                              title={`Primary: ${workspaceBrand.primaryColor}`}
                            />
                            <span className="text-sm text-muted-foreground font-mono">
                              {workspaceBrand.primaryColor}
                            </span>
                          </div>
                        )}
                        {workspaceBrand.secondaryColor && (
                          <div className="flex items-center gap-2">
                            <div
                              className="w-8 h-8 rounded-lg border border-border"
                              style={{
                                backgroundColor: workspaceBrand.secondaryColor,
                              }}
                              title={`Secondary: ${workspaceBrand.secondaryColor}`}
                            />
                            <span className="text-sm text-muted-foreground font-mono">
                              {workspaceBrand.secondaryColor}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="guidelines">
              {(!guidelinesStatus || guidelinesStatus === "pending") && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin mb-4" />
                      <p>Waiting for brand guidelines research to start...</p>
                      <p className="text-sm mt-1">This will begin automatically</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {guidelinesStatus === "processing" && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin mb-4" />
                      <p>Researching brand guidelines...</p>
                      <p className="text-sm mt-1">This may take a minute</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {guidelinesStatus === "failed" && editedGuidelines && (
                <div className="space-y-6">
                  <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    <p className="text-destructive">
                      Failed to research brand guidelines automatically. You can add them manually below.
                    </p>
                  </div>
                  <GuidelinesPreview
                    guidelines={editedGuidelines}
                    onGuidelinesChange={setEditedGuidelines}
                    onSave={handleSaveGuidelines}
                    isSaving={isSavingGuidelines}
                  />
                </div>
              )}

              {guidelinesStatus === "not_found" && editedGuidelines && (
                <div className="space-y-6">
                  <div className="flex items-center gap-2 p-3 bg-muted border border-border rounded-lg text-sm">
                    <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                    <p className="text-muted-foreground">
                      No brand guidelines found online. You can add them manually below.
                    </p>
                  </div>
                  <GuidelinesPreview
                    guidelines={editedGuidelines}
                    onGuidelinesChange={setEditedGuidelines}
                    onSave={handleSaveGuidelines}
                    isSaving={isSavingGuidelines}
                  />
                </div>
              )}

              {guidelinesStatus === "completed" && editedGuidelines && (
                <GuidelinesPreview
                  guidelines={editedGuidelines}
                  onGuidelinesChange={setEditedGuidelines}
                  onSave={handleSaveGuidelines}
                  isSaving={isSavingGuidelines}
                />
              )}
            </TabsContent>

            <TabsContent value="audience">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-12 text-muted-foreground">
                    Audience insights coming soon
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tone">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-12 text-muted-foreground">
                    Tone & style guidelines coming soon
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="competitors">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-12 text-muted-foreground">
                    Competitor analysis coming soon
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="files">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-12 text-muted-foreground">
                    Brand files coming soon
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
      </GradientPage>
    );
  };

  // Render empty state
  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Globe className="w-8 h-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        No brand linked
      </h2>
      <p className="text-muted-foreground text-center max-w-md mb-6">
        Add a brand to this workspace to maintain consistent messaging and
        styling across your content.
      </p>
      <Button onClick={() => setState("search")}>Add Brand</Button>
    </div>
  );

  return (
    <div className="h-full">
      {error && (
        <div className="mx-6 mt-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      {state === "loading" && (
        <div className="p-6">
          <BrandLoadingState message="Loading brand settings..." />
        </div>
      )}

      {state === "linked" && renderBrandDetail()}

      {state === "empty" && <div className="p-6">{renderEmptyState()}</div>}

      {state === "search" && (
        <div className="p-6">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-foreground">
              Add Brand
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Search for a brand by name or enter a website URL
            </p>
          </div>
          <BrandSearchForm onSearch={handleSearch} isLoading={false} />
          <div className="mt-4 text-center">
            <Button variant="ghost" size="sm" onClick={() => setState("empty")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {state === "searching" && (
        <div className="p-6">
          <BrandLoadingState message="Searching for brand..." />
        </div>
      )}

      {state === "disambiguation" && (
        <div className="p-6">
          <BrandDisambiguation
            results={disambiguationResults}
            onSelect={handleDisambiguationSelect}
            onCreateFromScratch={handleCreateFromScratch}
            isLoading={false}
          />
          <div className="mt-4 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setState("search")}
            >
              Back to search
            </Button>
          </div>
        </div>
      )}

      {state === "researching" && (
        <div className="p-6">
          <BrandLoadingState message="Researching brand details..." />
        </div>
      )}

      {state === "preview" && (
        <div className="p-6">
          <BrandPreview
            brand={previewBrand}
            onSave={handleSaveBrand}
            onCancel={() => {
              if (workspaceBrand) {
                setState("linked");
              } else {
                setState("search");
              }
            }}
            isLoading={isActionLoading}
          />
        </div>
      )}
    </div>
  );
}
