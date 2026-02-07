import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrandSearch } from "./useBrandSearch";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useBrandSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in idle state with no errors", () => {
    const { result } = renderHook(() => useBrandSearch());

    expect(result.current.searchState).toBe("idle");
    expect(result.current.disambiguationResults).toEqual([]);
    expect(result.current.previewBrand).toBeNull();
    expect(result.current.error).toBeNull();
  });

  describe("handleSearch", () => {
    it("transitions to searching state on search", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ brand: { name: "Test" } }),
      });

      const { result } = renderHook(() => useBrandSearch());

      await act(async () => {
        result.current.handleSearch("Test Brand", "name");
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/brand/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Test Brand", type: "name" }),
      });
    });

    it("transitions to preview when single brand found", async () => {
      const mockBrand = { name: "Test Brand", websiteUrl: "https://test.com" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ brand: mockBrand }),
      });

      const { result } = renderHook(() => useBrandSearch());

      await act(async () => {
        result.current.handleSearch("Test Brand", "name");
      });

      expect(result.current.searchState).toBe("preview");
      expect(result.current.previewBrand).toEqual(mockBrand);
    });

    it("transitions to disambiguation with multiple results", async () => {
      const results = [
        { name: "Brand A", description: "Desc A", websiteUrl: "https://a.com" },
        { name: "Brand B", description: "Desc B", websiteUrl: "https://b.com" },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ needsDisambiguation: true, results }),
      });

      const { result } = renderHook(() => useBrandSearch());

      await act(async () => {
        result.current.handleSearch("Brand", "name");
      });

      expect(result.current.searchState).toBe("disambiguation");
      expect(result.current.disambiguationResults).toEqual(results);
    });

    it("auto-selects when single result returned", async () => {
      const singleResult = [{ name: "Brand A", description: "Desc", websiteUrl: "https://a.com" }];
      const mockBrand = { name: "Brand A", websiteUrl: "https://a.com" };

      // First call returns single result, second call researches it
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ results: singleResult }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ brand: mockBrand }),
        });

      const { result } = renderHook(() => useBrandSearch());

      await act(async () => {
        result.current.handleSearch("Brand A", "name");
      });

      expect(result.current.searchState).toBe("preview");
      expect(result.current.previewBrand).toEqual(mockBrand);
    });

    it("sets error on no results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });

      const { result } = renderHook(() => useBrandSearch());

      await act(async () => {
        result.current.handleSearch("Unknown Brand", "name");
      });

      expect(result.current.searchState).toBe("idle");
      expect(result.current.error).toBe("No results found");
    });

    it("sets error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useBrandSearch());

      await act(async () => {
        result.current.handleSearch("Brand", "name");
      });

      expect(result.current.searchState).toBe("idle");
      expect(result.current.error).toBe(
        "Failed to research brand. Please try again."
      );
    });

    it("sets error on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const { result } = renderHook(() => useBrandSearch());

      await act(async () => {
        result.current.handleSearch("Brand", "name");
      });

      expect(result.current.searchState).toBe("idle");
      expect(result.current.error).toBeTruthy();
    });
  });

  describe("handleDisambiguationSelect", () => {
    it("researches selected brand and transitions to preview", async () => {
      const selection = { name: "Brand A", description: "Desc", websiteUrl: "https://a.com" };
      const mockBrand = { name: "Brand A", websiteUrl: "https://a.com" };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ brand: mockBrand }),
      });

      const { result } = renderHook(() => useBrandSearch());

      await act(async () => {
        result.current.handleDisambiguationSelect(selection);
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/brand/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "selection", selection }),
      });
      expect(result.current.searchState).toBe("preview");
      expect(result.current.previewBrand).toEqual(mockBrand);
    });

    it("falls back to disambiguation on research failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Research failed"));

      const { result } = renderHook(() => useBrandSearch());

      await act(async () => {
        result.current.handleDisambiguationSelect({
          name: "Brand",
          description: "Desc",
          websiteUrl: "https://brand.com",
        });
      });

      expect(result.current.searchState).toBe("disambiguation");
      expect(result.current.error).toBeTruthy();
    });
  });

  describe("handleCreateFromScratch", () => {
    it("sets empty preview brand and transitions to preview", () => {
      const { result } = renderHook(() => useBrandSearch());

      act(() => {
        result.current.handleCreateFromScratch();
      });

      expect(result.current.searchState).toBe("preview");
      expect(result.current.previewBrand).toEqual({});
    });
  });

  describe("reset", () => {
    it("resets all state to initial values", async () => {
      const mockBrand = { name: "Test" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ brand: mockBrand }),
      });

      const { result } = renderHook(() => useBrandSearch());

      // First advance to a non-idle state
      await act(async () => {
        result.current.handleSearch("Test", "name");
      });
      expect(result.current.searchState).toBe("preview");

      // Then reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.searchState).toBe("idle");
      expect(result.current.disambiguationResults).toEqual([]);
      expect(result.current.previewBrand).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });
});
