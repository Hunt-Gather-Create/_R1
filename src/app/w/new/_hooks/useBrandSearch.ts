"use client";

import { useState, useCallback } from "react";
import type { Brand, BrandSearchResult } from "@/lib/types";

export type BrandSearchState =
  | "idle"
  | "searching"
  | "disambiguation"
  | "researching"
  | "preview";

export function useBrandSearch() {
  const [searchState, setSearchState] = useState<BrandSearchState>("idle");
  const [disambiguationResults, setDisambiguationResults] = useState<
    BrandSearchResult[]
  >([]);
  const [previewBrand, setPreviewBrand] = useState<Partial<Brand> | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const handleDisambiguationSelect = useCallback(
    async (result: BrandSearchResult) => {
      setSearchState("researching");
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
          setSearchState("preview");
        } else {
          setError("Failed to get brand details");
          setSearchState("disambiguation");
        }
      } catch (err) {
        console.error("Research error:", err);
        setError("Failed to research brand. Please try again.");
        setSearchState("disambiguation");
      }
    },
    []
  );

  const handleSearch = useCallback(
    async (query: string, type: "name" | "url") => {
      setSearchState("searching");
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
          setDisambiguationResults(data.results);
          setSearchState("disambiguation");
        } else if (data.brand) {
          setPreviewBrand(data.brand);
          setSearchState("preview");
        } else if (data.results?.length === 1) {
          const result = data.results[0];
          handleDisambiguationSelect(result);
        } else if (data.results?.length > 0) {
          setDisambiguationResults(data.results);
          setSearchState("disambiguation");
        } else {
          setError("No results found");
          setSearchState("idle");
        }
      } catch (err) {
        console.error("Search error:", err);
        setError("Failed to research brand. Please try again.");
        setSearchState("idle");
      }
    },
    [handleDisambiguationSelect]
  );

  const handleCreateFromScratch = useCallback(() => {
    setPreviewBrand({});
    setSearchState("preview");
  }, []);

  const reset = useCallback(() => {
    setSearchState("idle");
    setDisambiguationResults([]);
    setPreviewBrand(null);
    setError(null);
  }, []);

  return {
    searchState,
    disambiguationResults,
    previewBrand,
    error,
    handleSearch,
    handleDisambiguationSelect,
    handleCreateFromScratch,
    reset,
  };
}
