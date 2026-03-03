import * as dns from "node:dns";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLlmsTxtTool, fetchLlmsTxt, llmsTxtTool } from "./llms-txt";

// Mock DNS so validateUrl allows test hostnames (public IP)
vi.mock("node:dns", () => ({
  promises: {
    lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
  },
}));

describe("fetchLlmsTxt", () => {
  const mockFetch = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("resolves llms.txt URL from the given URL origin", async () => {
    mockFetch.mockResolvedValue(
      new Response("# Example\n", {
        headers: { "Content-Type": "text/plain" },
      })
    );

    await fetchLlmsTxt("https://example.com/path/to/page");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/llms.txt",
      expect.objectContaining({
        redirect: "manual",
        headers: { Accept: "text/plain, text/markdown" },
      })
    );
  });

  it("returns content on 200", async () => {
    const content = "# Project\n\n> Summary\n";
    mockFetch.mockResolvedValue(
      new Response(content, { headers: { "Content-Type": "text/plain" } })
    );

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

describe("fetchLlmsTxt SSRF and safety", () => {
  const mockFetch = vi.fn();
  const dnsLookup = vi.mocked(dns.promises.lookup);

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    (
      dnsLookup as unknown as {
        mockResolvedValue: (v: dns.LookupAddress[]) => void;
      }
    ).mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  it("returns null for non-http(s) URL", async () => {
    const result = await fetchLlmsTxt("file:///etc/passwd");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null for URL with credentials", async () => {
    const result = await fetchLlmsTxt("https://user:pass@example.com");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when DNS resolves to private IP", async () => {
    (
      dnsLookup as unknown as {
        mockResolvedValueOnce: (v: dns.LookupAddress[]) => void;
      }
    ).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const result = await fetchLlmsTxt("https://localhost.example.com");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null for disallowed port", async () => {
    const result = await fetchLlmsTxt("https://example.com:8080");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null on redirect (manual redirect policy)", async () => {
    mockFetch.mockResolvedValue(
      new Response("", { status: 302, headers: { Location: "https://other.com/llms.txt" } })
    );
    const result = await fetchLlmsTxt("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null when response exceeds size limit", async () => {
    const big = "x".repeat(300 * 1024);
    mockFetch.mockResolvedValue(
      new Response(big, { headers: { "Content-Type": "text/plain" } })
    );
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
    mockFetch.mockResolvedValue(
      new Response(content, { headers: { "Content-Type": "text/plain" } })
    );

    const execute = llmsTxtTool.execute;
    expect(execute).toBeDefined();
    const result = await (execute as (args: { url: string }) => Promise<string>)(
      { url: "https://example.com" }
    );

    expect(result).toBe(content);
  });

  it("execute returns fallback message when llms.txt not found", async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const execute = llmsTxtTool.execute;
    expect(execute).toBeDefined();
    const result = await (execute as (args: { url: string }) => Promise<string>)(
      { url: "https://example.com" }
    );

    expect(result).toBe("No llms.txt found for this site.");
  });
});

describe("createLlmsTxtTool", () => {
  const mockFetch = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response("# Ok", { headers: { "Content-Type": "text/plain" } })
      )
    );
  });

  it("enforces maxUses and returns limit message when exceeded", async () => {
    const limitedTool = createLlmsTxtTool(2);
    const execute = limitedTool.execute;
    expect(execute).toBeDefined();
    const run = execute as (args: { url: string }) => Promise<string>;

    const first = await run({ url: "https://a.com" });
    const second = await run({ url: "https://b.com" });
    const third = await run({ url: "https://c.com" });

    expect(first).toBe("# Ok");
    expect(second).toBe("# Ok");
    expect(third).toBe(
      "llms_txt tool limit reached for this conversation. Do not call llms_txt again."
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
