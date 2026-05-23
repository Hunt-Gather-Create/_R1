import { test, expect } from "@playwright/test";

// Smoke for PR #104 (Hunt-Gather-Create/_R1) — dashboard predicate + display cleanup.
// Fixes #3, #53, #4, #41, #49. Merged 2026-05-22 as squash 338fb55 on runway.
//
// Each spec captures a screenshot for human visual review and asserts on
// DOM-visible markers where they're stable. CSS / layout regressions still
// require eyes on the screenshots — DOM assertions only catch presence.

const SHOT_DIR = "screenshots/pr-104";

test.describe("PR #104 post-merge smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/runway");
    await page.waitForLoadState("networkidle");
  });

  test("#3 — In Flight column surfaces scheduled L2s mid-window", async ({ page }) => {
    await page.getByRole("button", { name: /by week/i }).first().click().catch(() => {});
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SHOT_DIR}/01-by-week-in-flight.png`, fullPage: true });
  });

  test("#53 — Needs Update no longer shows canceled items", async ({ page }) => {
    const needsUpdate = page.getByText(/needs update/i).first();
    await expect(needsUpdate).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/02-needs-update.png`, fullPage: true });

    // Page-wide check: these two items must not appear ANYWHERE on the default
    // dashboard view if the fix is deployed. (They could legitimately appear
    // elsewhere if the page renders multiple buckets; if so, scope tighter.)
    const inductive = page.getByText(/Inductive Top 10 . Social Post/i);
    const social = page.getByText(/Social: Award . TI/i);
    await expect(inductive).toHaveCount(0);
    await expect(social).toHaveCount(0);
  });

  test("#4 — Canceled L1 renders across views; canceled L2s hidden from This Week", async ({ page }) => {
    await page.screenshot({ path: `${SHOT_DIR}/03a-weekof-default.png`, fullPage: true });

    await page.getByRole("button", { name: /by account/i }).first().click().catch(() => {});
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SHOT_DIR}/03b-by-account.png`, fullPage: true });

    await page.getByRole("button", { name: /gantt charts/i }).first().click().catch(() => {});
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SHOT_DIR}/03c-gantt-charts.png`, fullPage: true });
  });

  test("#41 — ReadyToClose chip suppressed on empty L1 sections", async ({ page }) => {
    await page.getByRole("button", { name: /by account/i }).first().click().catch(() => {});
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SHOT_DIR}/04-by-account-chips.png`, fullPage: true });
  });

  test("#49 — Gantt Charts client-level chevron present + rotates", async ({ page }) => {
    await page.getByRole("button", { name: /gantt charts/i }).first().click().catch(() => {});
    await page.waitForLoadState("networkidle");

    const accountDetails = page.locator("details.gantt-charts-details").first();
    await expect(accountDetails).toBeVisible({ timeout: 10_000 });
    const chevron = accountDetails.locator(".gantt-charts-chevron").first();
    await expect(chevron).toBeVisible();

    const initiallyOpen = await accountDetails.evaluate((el) => el.hasAttribute("open"));
    await page.screenshot({ path: `${SHOT_DIR}/05a-gantt-initial.png`, fullPage: true });

    const summary = accountDetails.locator("summary").first();
    await summary.click();
    await page.waitForTimeout(300);

    const afterClick = await accountDetails.evaluate((el) => el.hasAttribute("open"));
    expect(afterClick).toBe(!initiallyOpen);
    await page.screenshot({ path: `${SHOT_DIR}/05b-gantt-toggled.png`, fullPage: true });

    await summary.click();
    await page.waitForTimeout(300);
    const afterSecondClick = await accountDetails.evaluate((el) => el.hasAttribute("open"));
    expect(afterSecondClick).toBe(initiallyOpen);
  });
});
