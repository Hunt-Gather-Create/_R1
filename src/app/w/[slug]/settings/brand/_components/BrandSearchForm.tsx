"use client";

import { useState } from "react";
import { Search, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BrandSearchFormProps {
  onSearch: (query: string, type: "name" | "url") => void;
  isLoading: boolean;
}

export function BrandSearchForm({ onSearch, isLoading }: BrandSearchFormProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // Detect if input is a URL
    const isUrl = query.startsWith("http://") || query.startsWith("https://") || query.includes(".");
    const type = isUrl ? "url" : "name";

    // For URLs that don't have protocol, add https://
    let searchQuery = query.trim();
    if (type === "url" && !searchQuery.startsWith("http")) {
      searchQuery = `https://${searchQuery}`;
    }

    onSearch(searchQuery, type);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl mx-auto">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none z-10">
          {query.includes(".") ? (
            <LinkIcon className="w-4 h-4 text-muted-foreground" />
          ) : (
            <Search className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter brand name or website URL..."
          className="pl-10 h-11"
          disabled={isLoading}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground text-center">
        Enter a brand name to search, or paste a website URL for direct lookup
      </p>
      <div className="mt-4 flex justify-center">
        <Button
          type="submit"
          disabled={!query.trim() || isLoading}
        >
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </div>
    </form>
  );
}
