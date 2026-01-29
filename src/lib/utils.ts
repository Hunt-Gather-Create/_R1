import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Transform <cite> tags into clickable Google search links.
 * These tags come from Claude's web search - we convert them to searchable links.
 * Use this for chat bubbles where users want to explore sources.
 */
export function transformCiteTags(content: string): string {
  return content.replace(/<cite[^>]*>(.*?)<\/cite>/gi, (_, text) => {
    const searchQuery = encodeURIComponent(text.trim());
    return `<a href="https://www.google.com/search?q=${searchQuery}" target="_blank" rel="noopener noreferrer" class="citation-link">${text}</a>`;
  });
}

/**
 * Strip <cite> tags from content while preserving their text.
 * Use this for final reports/attachments where citations should be clean text.
 */
export function stripCiteTags(content: string): string {
  return content.replace(/<cite[^>]*>(.*?)<\/cite>/gi, "$1");
}
