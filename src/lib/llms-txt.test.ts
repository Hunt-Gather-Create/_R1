import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchLlmsTxt, llmsTxtTool } from "./llms-txt";

describe("fetchLlmsTxt", () => {
  const mockFetch = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("resolves llms.txt URL from the given URL origin", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Example\n"),
    });

    await fetchLlmsTxt("https://example.com/path/to/page");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/llms.txt",
      expect.objectContaining({
        headers: { Accept: "text/plain, text/markdown" },
      })
    );
  });

  it("returns content on 200", async () => {
    const content = "# Project\n\n> Summary\n";
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(content),
    });

    const result = await fetchLlmsTxt("https://example.com");

    expect(result).toBe(content);
  });

  it("returns null on 404", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await fetchLlmsTxt("https://example.com");

    expect(result).toBeNull();
  });

  it("returns null on 5xx", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await fetchLlmsTxt("https://example.com");

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchLlmsTxt("https://example.com");

    expect(result).toBeNull();
  });
});

describe("llmsTxtTool", () => {
  const mockFetch = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("execute returns markdown when llms.txt exists", async () => {
    const content = "# Site\n\n> Overview\n";
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(content),
    });

    const result = await llmsTxtTool.execute({ url: "https://example.com" });

    expect(result).toBe(content);
  });

  it("execute returns fallback message when llms.txt not found", async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const result = await llmsTxtTool.execute({ url: "https://example.com" });

    expect(result).toBe("No llms.txt found for this site.");
  });
});
