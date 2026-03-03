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

const LLMS_TXT_DESCRIPTION =
  "Fetch the llms.txt file from a website. Returns LLM-friendly markdown if the site provides it. Use when the browser API (web_fetch) fails or when you need a lightweight fallback for structured project/site overview and links to docs. How to read llms.txt: it is markdown with (1) an H1 heading = project/site name, (2) a blockquote = short summary, (3) optional paragraphs, then (4) H2 sections with bullet lists of [link text](url) entries pointing to more detail; use the summary first, and follow linked URLs only if you need deeper content.";

/**
 * AI-callable tool to fetch a site's llms.txt (no usage limit).
 * Prefer createLlmsTxtTool(maxUses) when you need per-request limits.
 */
export const llmsTxtTool = tool({
  description: LLMS_TXT_DESCRIPTION,
  inputSchema: llmsTxtInputSchema,
  execute: async ({ url }) => {
    const content = await fetchLlmsTxt(url);
    if (content !== null) {
      return content;
    }
    return "No llms.txt found for this site.";
  },
});

const MAX_USES_REACHED_MESSAGE =
  "llms_txt tool limit reached for this conversation. Do not call llms_txt again.";

/**
 * Create an llms_txt tool with a per-request usage limit.
 * Use this in chat so limits don't leak across requests.
 */
export function createLlmsTxtTool(maxUses: number) {
  let usesLeft = maxUses;
  return tool({
    description: LLMS_TXT_DESCRIPTION,
    inputSchema: llmsTxtInputSchema,
    execute: async ({ url }) => {
      if (usesLeft <= 0) {
        return MAX_USES_REACHED_MESSAGE;
      }
      usesLeft -= 1;
      const content = await fetchLlmsTxt(url);
      if (content !== null) {
        return content;
      }
      return "No llms.txt found for this site.";
    },
  });
}
