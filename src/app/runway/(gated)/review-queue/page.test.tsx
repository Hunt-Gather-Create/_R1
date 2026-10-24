import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { render, screen, within } from "@testing-library/react";
import type { Client } from "@libsql/client";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/db/runway", () => ({ getRunwayDb: () => holder.db }));
vi.mock("./actions", () => ({
  approveReviewQueueRowAction: vi.fn(),
  dismissReviewQueueRowAction: vi.fn(),
}));

import { createTestDb, seedTestDb, cleanupTestDb } from "@/lib/runway/test-db";
import ReviewQueuePage from "./page";

describe("review queue route", () => {
  it("lives under the (gated) route group, so the password gate layout covers it", () => {
    const pageFile = join(__dirname, "page.tsx");
    const gatedDir = join(__dirname, "..");
    expect(existsSync(pageFile)).toBe(true);
    expect(dirname(gatedDir).endsWith(join("app", "runway"))).toBe(true);
    expect(gatedDir.split(sep).pop()).toBe("(gated)");
    expect(existsSync(join(gatedDir, "layout.tsx"))).toBe(true);
    expect(relative(gatedDir, pageFile)).toBe(join("review-queue", "page.tsx"));
  });
});

describe("ReviewQueuePage", () => {
  let client: Client;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    client = t.client;
    dbPath = t.dbPath;
    holder.db = t.db;
  });
  afterEach(() => {
    client.close();
    cleanupTestDb(dbPath);
  });

  it("shows a held row with its run id, reason, plain-words change and values", async () => {
    await client.execute({
      sql: "INSERT INTO apply_review_queue (id, run_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
      args: [
        "rq-1",
        "run-2026-10-24-a",
        JSON.stringify({
          op: "addProject",
          params: { clientSlug: "acme", name: "Spring Launch", updatedBy: "sheet-sync" },
          reason: "no Runway L1 matched this engagement",
        }),
        1792800000,
      ],
    });

    render(await ReviewQueuePage());

    const row = screen.getByTestId("review-queue-row-rq-1");
    expect(within(row).getByText("run-2026-10-24-a")).toBeTruthy();
    expect(within(row).getByText("no Runway Project matched this engagement")).toBeTruthy();
    expect(within(row).getByText('Create Project "Spring Launch" for client acme')).toBeTruthy();
    expect(within(row).getByText("Spring Launch")).toBeTruthy();
    expect(within(row).getByText("Pending")).toBeTruthy();
    expect(row.textContent).not.toMatch(/\bL1\b/);
  });

  it("says the queue is empty only when the read returns no rows", async () => {
    render(await ReviewQueuePage());
    expect(screen.getByText(/no held changes/i)).toBeTruthy();
  });

  it("shows who resolved a row and hides its buttons", async () => {
    await client.execute({
      sql: "INSERT INTO apply_review_queue (id, run_id, payload_json, created_at, status, resolved_at, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["rq-2", "run-b", JSON.stringify({ op: "flag-for-review", params: {}, reason: "r" }), 1792800000, "dismissed", 1792800500, "operator"],
    });

    render(await ReviewQueuePage());

    const row = screen.getByTestId("review-queue-row-rq-2");
    expect(within(row).getByText(/Dismissed by operator/)).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /approve/i })).toBeNull();
  });
});
