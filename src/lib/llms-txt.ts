/**
 * llms.txt client – fetch LLM-friendly content from a site's /llms.txt
 * https://llmstxt.org/
 *
 * SSRF protections: URL validation (scheme, no credentials, no private/loopback
 * IPs), no redirect follow, and response size cap. Validation lives in @/lib/utils/ssrf-utils.
 */

import { validateUrlForSafeFetch } from "@/lib/utils/ssrf-utils";
import { tool } from "ai";
import { z } from "zod";

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 256 * 1024; // 256KB

function logBlockedAttempt(reason: string): void {
  if (process.env.NODE_ENV !== "test") {
    console.warn("llms_txt: request blocked", { reason });
  }
}

async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > maxBytes) {
          reader.cancel();
          throw new Error("response_too_large");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(combined);
}

/**
 * Fetch the llms.txt file from a website's origin.
 * Returns the markdown content on 200 (within size limit), otherwise null.
 * SSRF-safe: validates URL (scheme, no credentials, no private IPs), no redirects, response capped.
 */
export async function fetchLlmsTxt(url: string): Promise<string | null> {
  const validation = await validateUrlForSafeFetch(url);
  if (!validation.ok) {
    logBlockedAttempt(validation.reason);
    return null;
  }

  const llmsUrl = `${validation.parsed.origin}/llms.txt`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(llmsUrl, {
      signal: controller.signal,
      redirect: "manual",
      headers: { Accept: "text/plain, text/markdown" },
    });
    clearTimeout(timeoutId);

    if (response.status >= 300 && response.status < 400) {
      logBlockedAttempt("redirect_not_followed");
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const len = parseInt(contentLength, 10);
      if (!Number.isNaN(len) && len > MAX_RESPONSE_BYTES) {
        logBlockedAttempt("content_length_exceeds_limit");
        return null;
      }
    }

    const text = await readBodyWithLimit(response.body, MAX_RESPONSE_BYTES);
    return text;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.message === "response_too_large")
    ) {
      if (err.message === "response_too_large") {
        logBlockedAttempt("response_too_large");
      }
    }
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
