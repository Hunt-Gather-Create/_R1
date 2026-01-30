/**
 * Logo processing utilities
 * - Download logos from URLs
 * - Upload to R2 for persistence
 * - Analyze logo to determine optimal background color using AI vision
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

// Create S3 client for R2
function createS3Client(): S3Client {
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error("R2 credentials not configured");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function getBucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME not configured");
  }
  return bucket;
}

/**
 * Generate storage key for a brand logo
 * Format: brands/{userId}/{brandId}/logo.{ext}
 */
export function generateBrandLogoKey(
  userId: string,
  brandId: string,
  mimeType: string
): string {
  const ext = mimeType.split("/")[1] || "png";
  return `brands/${userId}/${brandId}/logo.${ext}`;
}

/**
 * Download an image from a URL and return as buffer with content type
 */
async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        // Some servers require a user agent
        "User-Agent": "Mozilla/5.0 (compatible; BrandBot/1.0)",
      },
    });

    if (!response.ok) {
      console.error(`Failed to download image: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "image/png";

    // Only process images
    if (!contentType.startsWith("image/")) {
      console.error(`Not an image: ${contentType}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType,
    };
  } catch (error) {
    console.error("Failed to download image:", error);
    return null;
  }
}

/**
 * Analyze an SVG file to determine if it has predominantly light colors.
 * Parses the SVG content and looks for fill/stroke colors.
 */
function analyzeSvgColors(svgContent: string): "light" | "dark" {
  // Look for common light color patterns in SVG
  const lightColorPatterns = [
    /fill\s*[=:]\s*["']?(#fff|#ffffff|white|#f[0-9a-f]{5})/gi,
    /stroke\s*[=:]\s*["']?(#fff|#ffffff|white|#f[0-9a-f]{5})/gi,
    /fill\s*[=:]\s*["']?rgb\s*\(\s*2[0-4][0-9]|25[0-5]/gi, // RGB values > 240
    /style\s*=\s*["'][^"']*fill\s*:\s*(#fff|#ffffff|white)/gi,
  ];

  const darkColorPatterns = [
    /fill\s*[=:]\s*["']?(#000|#000000|black|#[0-3][0-9a-f]{5})/gi,
    /stroke\s*[=:]\s*["']?(#000|#000000|black|#[0-3][0-9a-f]{5})/gi,
    /fill\s*[=:]\s*["']?rgb\s*\(\s*[0-5]?[0-9]/gi, // RGB values < 60
  ];

  let lightMatches = 0;
  let darkMatches = 0;

  for (const pattern of lightColorPatterns) {
    const matches = svgContent.match(pattern);
    if (matches) lightMatches += matches.length;
  }

  for (const pattern of darkColorPatterns) {
    const matches = svgContent.match(pattern);
    if (matches) darkMatches += matches.length;
  }

  // If more light colors found, logo needs dark background
  if (lightMatches > darkMatches) {
    return "dark";
  }
  return "light";
}

/**
 * Analyze a logo image using AI vision to determine optimal background color.
 *
 * Uses Claude's vision capabilities to understand the logo's colors,
 * transparency, and visual characteristics to recommend whether it
 * should be displayed on a light or dark background.
 *
 * For SVG files (which can't be processed by vision API), parses the
 * SVG content to analyze fill/stroke colors.
 */
export async function analyzeLogoBackground(
  imageBuffer: Buffer,
  contentType: string
): Promise<"light" | "dark"> {
  // Handle SVG files separately (vision API doesn't support SVG)
  if (contentType === "image/svg+xml" || contentType.includes("svg")) {
    const svgContent = imageBuffer.toString("utf-8");
    return analyzeSvgColors(svgContent);
  }

  try {
    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: imageBuffer,
            },
            {
              type: "text",
              text: `Analyze this logo image and determine whether it should be displayed on a LIGHT background (white/cream) or a DARK background (dark gray/black).

Consider:
- If the logo is predominantly white, light-colored, or has white/light text, it needs a DARK background to be visible
- If the logo is predominantly dark, black, or has dark text, it needs a LIGHT background to be visible
- If the logo has transparency and the main visual elements are light-colored, it needs a DARK background
- If the logo has good contrast and would work on either, prefer LIGHT background

Respond with ONLY one word: either "light" or "dark" (lowercase, no quotes, no explanation).`,
            },
          ],
        },
      ],
    });

    const answer = result.text.trim().toLowerCase();

    if (answer === "dark") {
      return "dark";
    } else {
      return "light"; // Default to light if unclear
    }
  } catch (error) {
    console.error("Failed to analyze logo with AI:", error);
    return "light"; // Default to light background on error
  }
}

/**
 * Upload a buffer directly to R2
 */
async function uploadToR2(
  storageKey: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const client = createS3Client();
  const bucket = getBucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    Body: buffer,
    ContentType: contentType,
  });

  await client.send(command);
}

export interface ProcessedLogo {
  storageKey: string;
  background: "light" | "dark";
  contentType: string;
}

/**
 * Process a logo URL:
 * 1. Download the image
 * 2. Analyze for optimal background
 * 3. Upload to R2
 *
 * Returns null if processing fails (e.g., invalid URL, not an image)
 */
export async function processLogo(
  logoUrl: string,
  userId: string,
  brandId: string
): Promise<ProcessedLogo | null> {
  // Download the image
  const image = await downloadImage(logoUrl);
  if (!image) {
    return null;
  }

  // Analyze for background preference
  const background = await analyzeLogoBackground(image.buffer, image.contentType);

  // Generate storage key and upload
  const storageKey = generateBrandLogoKey(userId, brandId, image.contentType);

  try {
    await uploadToR2(storageKey, image.buffer, image.contentType);
  } catch (error) {
    console.error("Failed to upload logo to R2:", error);
    return null;
  }

  return {
    storageKey,
    background,
    contentType: image.contentType,
  };
}

/**
 * Check if R2 is configured for logo storage
 */
export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}
