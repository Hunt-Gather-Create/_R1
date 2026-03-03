/**
 * llms.txt client – fetch LLM-friendly content from a site's /llms.txt
 * https://llmstxt.org/
 */

import { tool } from "ai";
import { z } from "zod";

const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch the llms.txt file from a website's origin.
 * Returns the markdown content on 200, otherwise null.
 */
export async function fetchLlmsTxt(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    const llmsUrl = `${parsed.origin}/llms.txt`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(llmsUrl, {
      signal: controller.signal,
      headers: { Accept: "text/plain, text/markdown" },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

const llmsTxtInputSchema = z.object({
  url: z.string().describe("Full URL of the website (e.g. https://example.com)"),
});

/**
 * AI-callable tool to fetch a site's llms.txt.
 * Use when the browser API (web_fetch) fails or when you need a lightweight
 * fallback for structured project/site overview and links to docs.
 */
export const llmsTxtTool = tool({
  description:
    "Fetch the llms.txt file from a website. Returns LLM-friendly markdown if the site provides it. Use when the browser API (web_fetch) fails or when you need a lightweight fallback for structured project/site overview and links to docs.",
  inputSchema: llmsTxtInputSchema,
  execute: async ({ url }) => {
    const content = await fetchLlmsTxt(url);
    if (content !== null) {
      return content;
    }
    return "No llms.txt found for this site.";
  },
});
