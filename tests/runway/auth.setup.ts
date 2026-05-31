import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "../../playwright/.auth/runway.json");

setup("authenticate against runway password gate", async ({ page }) => {
  const password = process.env.PLAYWRIGHT_RUNWAY_PASSWORD;
  if (!password) {
    throw new Error(
      "PLAYWRIGHT_RUNWAY_PASSWORD env var is required. Set it in .env.local or export it before running.",
    );
  }

  await page.goto("/runway/auth?returnTo=/runway");
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /continue|submit|sign in/i }).click();

  // Wait for actual navigation to /runway (not the auth page itself, which can
  // contain "/runway" in its returnTo querystring and trip a glob match).
  await page.waitForURL((url) => url.pathname === "/runway", { timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  const cookies = await page.context().cookies();
  const authCookie = cookies.find((c) => c.name === "runway_auth");
  if (!authCookie) {
    throw new Error(
      "runway_auth cookie missing after login. Either the password is wrong or the auth response shape changed.",
    );
  }

  await page.context().storageState({ path: AUTH_FILE });
});
