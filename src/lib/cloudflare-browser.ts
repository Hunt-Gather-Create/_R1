/**
 * Cloudflare Browser Rendering API client
 * https://developers.cloudflare.com/browser-rendering/rest-api/
 */

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const BROWSER_API_TOKEN = process.env.BROWSER_API_TOKEN;

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/browser-rendering`;

interface ScreenshotOptions {
  /** Capture full page instead of just the viewport */
  fullPage?: boolean;
  /** Omit white background for transparency */
  omitBackground?: boolean;
  /** Image format */
  type?: "png" | "jpeg" | "webp";
  /** Quality (1-100), only for jpeg/webp */
  quality?: number;
  /** CSS selector to capture specific element */
  selector?: string;
}

interface ViewportOptions {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
}

interface GotoOptions {
  /** When to consider navigation complete */
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  /** Maximum navigation time in ms */
  timeout?: number;
}

export interface CaptureScreenshotParams {
  /** URL to capture */
  url: string;
  /** Screenshot options */
  screenshotOptions?: ScreenshotOptions;
  /** Viewport dimensions */
  viewport?: ViewportOptions;
  /** Navigation options */
  gotoOptions?: GotoOptions;
}

/**
 * Check if Cloudflare Browser Rendering is configured
 */
export function isCloudflareConfigured(): boolean {
  return Boolean(CLOUDFLARE_ACCOUNT_ID && BROWSER_API_TOKEN);
}

/**
 * Capture a screenshot of a URL using Cloudflare Browser Rendering
 * Returns the screenshot as a base64 string
 */
export async function captureScreenshot(
  params: CaptureScreenshotParams
): Promise<{ base64: string; contentType: string }> {
  if (!CLOUDFLARE_ACCOUNT_ID || !BROWSER_API_TOKEN) {
    throw new Error(
      "Cloudflare Browser Rendering not configured. Set CLOUDFLARE_ACCOUNT_ID and BROWSER_API_TOKEN environment variables."
    );
  }

  const response = await fetch(`${BASE_URL}/screenshot`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BROWSER_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: params.url,
      screenshotOptions: params.screenshotOptions ?? {},
      viewport: params.viewport ?? {
        width: 1280,
        height: 800,
      },
      gotoOptions: params.gotoOptions ?? {
        waitUntil: "networkidle2",
        timeout: 30000,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Cloudflare screenshot failed: ${response.status} ${errorText}`
    );
  }

  // Response is the raw image data
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType =
    response.headers.get("content-type") ?? "image/png";

  return { base64, contentType };
}

/**
 * Capture a screenshot optimized for brand color extraction
 * Uses "load" wait strategy which is faster than "networkidle2"
 * but still waits for images/stylesheets to load
 */
export async function captureScreenshotForBrandColors(
  url: string
): Promise<{ base64: string; contentType: string }> {
  return captureScreenshot({
    url,
    viewport: {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
    },
    gotoOptions: {
      // "load" waits for page + resources, but not all network activity
      // Much faster than "networkidle2" for sites with analytics/ads
      waitUntil: "load",
      timeout: 45000,
    },
    screenshotOptions: {
      type: "jpeg",
      quality: 80,
    },
  });
}
