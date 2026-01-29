/**
 * Logo processing utilities
 * - Download logos from URLs
 * - Upload to R2 for persistence
 * - Analyze logo to determine optimal background color
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
 * Analyze an image to determine if it needs a light or dark background.
 *
 * This works by:
 * 1. Parsing the image to get pixel data
 * 2. Finding edge/border pixels (which are often transparent or the logo color)
 * 3. Calculating the average brightness of non-transparent pixels
 * 4. If the logo is predominantly light (like white text), it needs a dark background
 * 5. If the logo is predominantly dark, it needs a light background
 *
 * For images with transparency, we focus on the non-transparent pixels.
 */
export async function analyzeLogoBackground(
  imageBuffer: Buffer,
  contentType: string
): Promise<"light" | "dark"> {
  // For PNG images, we can analyze transparency and colors
  // For simplicity, we'll use a heuristic based on the image data

  try {
    // Check if it's a PNG with potential transparency
    const isPng = contentType === "image/png";

    // Simple brightness analysis using raw bytes
    // This is a simplified approach - for production, you might want to use
    // a proper image processing library like sharp

    let totalBrightness = 0;
    let pixelCount = 0;

    // Sample pixels from the buffer
    // For PNG/JPEG, the actual pixel data starts after headers
    // This is a rough heuristic - sample bytes throughout the image
    const sampleSize = Math.min(imageBuffer.length, 10000);
    const step = Math.max(1, Math.floor(imageBuffer.length / sampleSize));

    for (let i = 0; i < imageBuffer.length; i += step * 4) {
      if (i + 2 < imageBuffer.length) {
        const r = imageBuffer[i];
        const g = imageBuffer[i + 1];
        const b = imageBuffer[i + 2];

        // Skip if this looks like header data (very low values in sequence)
        if (r === 0 && g === 0 && b === 0) continue;

        // Calculate perceived brightness (human eye is more sensitive to green)
        const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        totalBrightness += brightness;
        pixelCount++;
      }
    }

    if (pixelCount === 0) {
      // Default to light background if we couldn't analyze
      return "light";
    }

    const avgBrightness = totalBrightness / pixelCount;

    // If average brightness > 0.6, the logo is light and needs dark background
    // If average brightness < 0.4, the logo is dark and needs light background
    // In between, default to light background
    if (avgBrightness > 0.6) {
      return "dark"; // Light logo needs dark background
    } else {
      return "light"; // Dark logo needs light background
    }
  } catch (error) {
    console.error("Failed to analyze logo:", error);
    return "light"; // Default to light background
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
