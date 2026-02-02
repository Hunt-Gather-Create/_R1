import { anthropic } from "@ai-sdk/anthropic";
import { generateText, tool } from "ai";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { BrandSearchResult } from "@/lib/types";
// Use Haiku for cost efficiency
const RESEARCH_MODEL = "claude-haiku-4-5-20251001";
import {
  captureScreenshotForBrandColors,
  isCloudflareConfigured,
} from "@/lib/cloudflare-browser";

export const maxDuration = 60;

// Input schema
const ResearchInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("name"),
    query: z.string().min(1),
  }),
  z.object({
    type: z.literal("url"),
    query: z.string().url(),
  }),
  z.object({
    type: z.literal("selection"),
    selection: z.object({
      name: z.string(),
      description: z.string(),
      websiteUrl: z.string(),
      logoUrl: z.string().optional(),
    }),
  }),
]);

// System prompts for different research modes
const NAME_SEARCH_PROMPT = `You are a brand research assistant. The user wants to find information about a brand by name.

Your task:
1. Use web_search to find information about the brand
2. Determine if there are multiple possible matches (e.g., "Apple" could be Apple Inc. or Apple Records)
3. Use the report_results tool to return your findings

If you find multiple distinct brands with the same or similar names, set needsDisambiguation to true and include all matches.
If you find only one clear match, set needsDisambiguation to false and include that single result.

For each result, try to find:
- The official brand/company name
- A brief description (1-2 sentences)
- The official website URL
- A logo URL if available

Be thorough but concise. Focus on the most likely interpretations of the brand name.`;

const URL_RESEARCH_PROMPT = `You are a brand research assistant. The user has provided a specific website URL for a brand.

Your task:
1. Use web_fetch to load the page content
2. Extract brand information from the page
3. Use additional web_search if needed to find more details (tagline, industry, etc.)
4. IMPORTANT: You MUST call the report_brand tool with the extracted information. Do not respond with text - always use the tool.

Extract as much as you can:
- Brand name (required - look for company name, site title, or og:site_name)
- Tagline/slogan
- Description/about text
- Logo URL (look for og:image, apple-touch-icon, or logo images in the page)
- Primary brand color - look in CSS, meta tags, or search for brand guidelines
- Secondary brand color (accent color)
- Industry/category

Be accurate - only report information you actually found. For colors, if you truly cannot find brand colors after searching, leave them empty rather than defaulting to black/white.

CRITICAL: After gathering information, you MUST call the report_brand tool. Never respond without calling it.`;

const URL_RESEARCH_WITH_SCREENSHOT_PROMPT = `You are a brand research assistant. The user has provided a specific website URL for a brand.

You have been given a SCREENSHOT of the website. Use this to visually identify brand colors!

Your task:
1. FIRST, analyze the screenshot to identify brand colors visually:
   - PRIMARY COLOR: The main brand color - usually in the header, logo area, or primary buttons
   - SECONDARY COLOR: The accent/complementary color - look for:
     * Call-to-action buttons that differ from primary
     * Link hover colors
     * Accent highlights or underlines
     * Secondary navigation elements
     * Footer accents
     * Any color that complements the primary (often a contrasting or analogous color)
2. Use web_fetch to load the page content for text information
3. Use additional web_search if needed for more details
4. IMPORTANT: You MUST call the report_brand tool with the extracted information.

Extract:
- Brand name (required)
- Tagline/slogan
- Description/about text
- Logo URL (from og:image or page content)
- Primary brand color (the MAIN brand color from the screenshot - NOT black/white)
- Secondary brand color (the ACCENT color - if the site uses any color besides the primary, include it here. Look for hover states, CTAs, highlights)
- Industry/category

For colors: Extract actual hex values. Most websites use at least 2 colors. If you only see one prominent color, search for "[brand name] brand colors" or "[brand name] style guide" to find secondary colors.

CRITICAL: You MUST call the report_brand tool with your findings.`;

const SELECTION_RESEARCH_PROMPT = `You are a brand research assistant. The user has selected a specific brand and wants detailed information.

Brand selected: {{BRAND_NAME}}
Website: {{BRAND_URL}}

Your task:
1. Use web_fetch to load the brand's website
2. Use web_search to find additional information about the brand
3. Extract comprehensive brand information
4. Use the report_brand tool to return the information

Extract as much as you can:
- Confirm the brand name
- Tagline/slogan (their official marketing catchphrase)
- Description (what the company/brand does)
- Logo URL (official logo image URL)
- Primary brand color (their main brand color, as hex)
- Secondary brand color (if applicable)
- Industry/category (e.g., "Technology", "Fashion", "Food & Beverage")

Be accurate and thorough. Use the official website as the primary source.`;

// Tool schemas
const reportResultsSchema = z.object({
  needsDisambiguation: z.boolean().describe("True if multiple brands match the query"),
  results: z.array(z.object({
    name: z.string().describe("Official brand/company name"),
    description: z.string().describe("Brief description of the brand"),
    websiteUrl: z.string().describe("Official website URL"),
    logoUrl: z.string().optional().describe("Logo image URL if found"),
  })).describe("List of matching brands"),
});

const reportBrandSchema = z.object({
  name: z.string().describe("Brand name"),
  tagline: z.string().optional().describe("Brand tagline or slogan"),
  description: z.string().optional().describe("Description of the brand"),
  logoUrl: z.string().optional().describe("URL to the brand logo"),
  websiteUrl: z.string().optional().describe("Official website URL"),
  primaryColor: z.string().optional().describe("Primary brand color as hex (e.g., #ff0000). Only include if you found actual brand colors - do NOT default to black/white"),
  secondaryColor: z.string().optional().describe("Secondary/accent brand color as hex. Only include if found"),
  industry: z.string().optional().describe("Industry or category"),
});

// Tool definitions with execute functions (required for proper tool calling)
const reportResultsTool = tool({
  description: "Report the search results for brand disambiguation. You MUST call this tool with your findings.",
  inputSchema: reportResultsSchema,
  execute: async (input) => input, // Just return the input as the result
});

const reportBrandTool = tool({
  description: "Report the extracted brand information. You MUST call this tool with the brand details you found.",
  inputSchema: reportBrandSchema,
  execute: async (input) => input, // Just return the input as the result
});

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const input = ResearchInputSchema.parse(body);

    if (input.type === "name") {
      return handleNameSearch(input.query);
    } else if (input.type === "url") {
      return handleUrlResearch(input.query);
    } else {
      return handleSelectionResearch(input.selection);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Brand research error:", error);
    return NextResponse.json(
      { error: "Failed to research brand" },
      { status: 500 }
    );
  }
}

async function handleNameSearch(query: string) {
  const result = await generateText({
    model: anthropic(RESEARCH_MODEL),
    system: NAME_SEARCH_PROMPT,
    prompt: `Find information about the brand: "${query}"`,
    tools: {
      web_search: anthropic.tools.webSearch_20250305({ maxUses: 3 }),
      report_results: reportResultsTool,
    },
  });

  // Extract the tool result
  for (const step of result.steps) {
    for (const toolResult of step.toolResults) {
      if (toolResult.toolName === "report_results" && "output" in toolResult) {
        const data = (toolResult as { output: unknown }).output as {
          needsDisambiguation: boolean;
          results: BrandSearchResult[];
        };
        return NextResponse.json({
          needsDisambiguation: data.needsDisambiguation,
          results: data.results,
        });
      }
    }
  }

  // Fallback if no tool was called
  return NextResponse.json({
    needsDisambiguation: false,
    results: [],
    message: "Could not find brand information",
  });
}

async function handleUrlResearch(url: string) {
  // Try to capture a screenshot for visual color extraction
  let screenshotBase64: string | null = null;

  if (isCloudflareConfigured()) {
    try {
      const screenshot = await captureScreenshotForBrandColors(url);
      screenshotBase64 = screenshot.base64;
    } catch (error) {
      console.error("Failed to capture screenshot:", error);
      // Continue without screenshot
    }
  }

  const tools = {
    web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 2 }),
    web_search: anthropic.tools.webSearch_20250305({ maxUses: 2 }),
    report_brand: reportBrandTool,
  };

  const result = screenshotBase64
    ? await generateText({
        model: anthropic(RESEARCH_MODEL),
        system: URL_RESEARCH_WITH_SCREENSHOT_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                image: Buffer.from(screenshotBase64, "base64"),
              },
              {
                type: "text",
                text: `This is a screenshot of ${url}. Extract brand information including colors from this screenshot and the page content.`,
              },
            ],
          },
        ],
        tools,
      })
    : await generateText({
        model: anthropic(RESEARCH_MODEL),
        system: URL_RESEARCH_PROMPT,
        prompt: `Extract brand information from this website: ${url}`,
        tools,
      });

  // Extract the tool result
  for (const step of result.steps) {
    for (const toolResult of step.toolResults) {
      if (toolResult.toolName === "report_brand" && "output" in toolResult) {
        return NextResponse.json({
          needsDisambiguation: false,
          brand: (toolResult as { output: unknown }).output,
        });
      }
    }
  }

  // Fallback: try to extract domain name as brand name
  // This ensures we always return something for a valid URL
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace("www.", "");
    const brandName = domain.split(".")[0];
    // Capitalize first letter
    const formattedName = brandName.charAt(0).toUpperCase() + brandName.slice(1);

    return NextResponse.json({
      needsDisambiguation: false,
      brand: {
        name: formattedName,
        websiteUrl: url,
      },
      message: "Basic brand info extracted from URL",
    });
  } catch {
    return NextResponse.json({
      needsDisambiguation: false,
      brand: null,
      message: "Could not extract brand information from URL",
    });
  }
}

async function handleSelectionResearch(selection: BrandSearchResult) {
  // If we have a website URL, use the URL research flow (with screenshot support)
  // This gives us better color extraction
  if (selection.websiteUrl) {
    return handleUrlResearch(selection.websiteUrl);
  }

  // Fallback for selections without a URL
  const prompt = SELECTION_RESEARCH_PROMPT
    .replace("{{BRAND_NAME}}", selection.name)
    .replace("{{BRAND_URL}}", selection.websiteUrl || "unknown");

  const result = await generateText({
    model: anthropic(RESEARCH_MODEL),
    system: prompt,
    prompt: `Research and extract detailed brand information for ${selection.name}`,
    tools: {
      web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 2 }),
      web_search: anthropic.tools.webSearch_20250305({ maxUses: 2 }),
      report_brand: reportBrandTool,
    },
  });

  // Extract the tool result
  for (const step of result.steps) {
    for (const toolResult of step.toolResults) {
      if (toolResult.toolName === "report_brand" && "output" in toolResult) {
        return NextResponse.json({
          needsDisambiguation: false,
          brand: (toolResult as { output: unknown }).output,
        });
      }
    }
  }

  // Fallback - return the selection data as the brand
  return NextResponse.json({
    needsDisambiguation: false,
    brand: {
      name: selection.name,
      description: selection.description,
      websiteUrl: selection.websiteUrl,
      logoUrl: selection.logoUrl,
    },
  });
}
