/**
 * Integration tests for generateGanttShare() in server.ts
 *
 * Uses the shared test-db seed harness (in-memory SQLite).
 * R2 is mocked — no real bucket touched.
 * RUNWAY_SHARE_SECRET is stubbed via vi.stubEnv.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import { randomUUID } from "crypto";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "@/lib/runway/test-db";

// Mock R2 client
const mockUploadContent = vi.fn();
vi.mock("@/lib/storage/r2-client", () => ({
  uploadContent: mockUploadContent,
}));

// Mock getRunwayDb to return the test DB
let testDb: TestDb;
vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

// Mock GanttTemplate renderers (return predictable strings, avoid logo file reads)
vi.mock("@/lib/runway/gantt/GanttTemplate", () => ({
  renderGantt: vi.fn(() => "<html>gantt</html>"),
  renderClientRundown: vi.fn(() => "<html>rundown</html>"),
}));

const SECRET = "test-secret-for-server-tests-00000000";

describe("generateGanttShare", () => {
  let libsqlClient: Client;
  let dbPath: string;

  beforeEach(async () => {
    vi.stubEnv("RUNWAY_SHARE_SECRET", SECRET);
    vi.stubEnv(
      "R2_ACCOUNT_ID",
      "test-account",
    );
    vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("R2_BUCKET_NAME", "test-bucket");

    mockUploadContent.mockReset();
    mockUploadContent.mockResolvedValue(undefined);

    const created = await createTestDb();
    libsqlClient = created.client;
    testDb = created.db;
    dbPath = created.dbPath;
    await seedTestDb(libsqlClient);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    cleanupTestDb(dbPath);
  });

  it("returns a parseable shareUrl, correct expiresAt (~7 days), and summary", async () => {
    const { generateGanttShare } = await import("./server");

    const result = await generateGanttShare({
      clientSlug: "convergix",
      theme: "light-branded",
    });

    expect(result.shareUrl).toMatch(
      /^https:\/\/runway\.startround1\.com\/api\/runway\/gantt-share\//,
    );

    // expiresAt should be ~7 days in the future
    const expiry = Date.parse(result.expiresAt);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expiry).toBeGreaterThan(Date.now() + sevenDaysMs - 60_000);
    expect(expiry).toBeLessThan(Date.now() + sevenDaysMs + 60_000);

    expect(result.summary.kind).toBe("client");
    expect(result.summary.clientName).toBe("Convergix");
    expect(typeof result.summary.sectionCount).toBe("number");
    expect(result.summary.sectionCount).toBeGreaterThan(0);
  });

  it("token from shareUrl round-trips through verifyToken", async () => {
    const { generateGanttShare } = await import("./server");
    const { verifyToken } = await import("./share-token");

    const result = await generateGanttShare({
      clientSlug: "convergix",
      theme: "light-branded",
    });

    // Extract token from URL
    const token = result.shareUrl.split("/api/runway/gantt-share/")[1];
    expect(token).toBeTruthy();

    const verification = verifyToken(token!);
    expect(verification.ok).toBe(true);
    if (!verification.ok) throw new Error("unreachable");
    expect(verification.payload.clientSlug).toBe("convergix");
    expect(verification.payload.theme).toBe("light-branded");
  });

  it("uploadContent is called with correct key, content-type, and metadata", async () => {
    const { generateGanttShare } = await import("./server");

    await generateGanttShare({
      clientSlug: "convergix",
      theme: "light-branded",
    });

    expect(mockUploadContent).toHaveBeenCalledTimes(1);
    const [storageKey, content, contentType, metadata] =
      mockUploadContent.mock.calls[0] as [
        string,
        string,
        string,
        Record<string, string>,
      ];

    expect(storageKey).toMatch(/^gantt-share\/[a-zA-Z0-9_-]+\/render\.html$/);
    expect(content).toBe("<html>rundown</html>");
    expect(contentType).toBe("text/html; charset=utf-8");
    expect(metadata["client-slug"]).toBe("convergix");
    expect(metadata["kind"]).toBe("client");
    expect(metadata["theme"]).toBe("light-branded");
    expect(typeof metadata["expires-at"]).toBe("string");
  });

  describe("env-var fallback for origin (Q1 amendment)", () => {
    it("uses NEXT_PUBLIC_APP_URL when origin is not provided", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.com");
      vi.resetModules();
      const { generateGanttShare } = await import("./server");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });

      expect(result.shareUrl).toMatch(
        /^https:\/\/staging\.example\.com\/api\/runway\/gantt-share\//,
      );
    });

    it("falls back to runway.startround1.com when neither origin nor NEXT_PUBLIC_APP_URL is set", async () => {
      // Clear NEXT_PUBLIC_APP_URL so it is falsy
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      vi.resetModules();
      const { generateGanttShare } = await import("./server");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });

      expect(result.shareUrl).toMatch(
        /^https:\/\/runway\.startround1\.com\/api\/runway\/gantt-share\//,
      );
    });
  });
});

// ── Wave 1.7 Issue 2: extractClientRundown filters empty wrapper-children ──

describe("extractClientRundown — empty wrapper-children filter (Issue 2)", () => {
  let libsqlClient: Client;
  let dbPath: string;

  beforeEach(async () => {
    const created = await createTestDb();
    libsqlClient = created.client;
    testDb = created.db;
    dbPath = created.dbPath;
    await seedTestDb(libsqlClient);
  });

  afterEach(() => {
    cleanupTestDb(dbPath);
  });

  it("wrapper-child with 0 weekItems does NOT appear as its own section, but DOES still appear in the wrapper's child rows", async () => {
    // Seed a wrapper + two children: one with weekItems, one empty.
    const NOW = Math.floor(Date.now() / 1000);
    const wrapperId = randomUUID();
    const childWithItemsId = randomUUID();
    const childEmptyId = randomUUID();

    await libsqlClient.executeMultiple(`
      INSERT INTO clients (id, name, slug, created_at, updated_at) VALUES
        ('cl-issue2', 'Issue2 Client', 'issue2-client', ${NOW}, ${NOW});

      INSERT INTO projects (id, client_id, name, status, category, engagement_type, parent_project_id, sort_order, created_at, updated_at) VALUES
        ('${wrapperId}', 'cl-issue2', '1H Wrapper', 'in-production', 'active', 'retainer', NULL, 0, ${NOW}, ${NOW}),
        ('${childWithItemsId}', 'cl-issue2', 'Child With Items', 'in-production', 'active', NULL, '${wrapperId}', 0, ${NOW}, ${NOW}),
        ('${childEmptyId}', 'cl-issue2', 'Child Empty L1', 'in-production', 'active', NULL, '${wrapperId}', 1, ${NOW}, ${NOW});

      INSERT INTO week_items (id, project_id, client_id, week_of, date, title, status, sort_order, created_at, updated_at) VALUES
        ('wi-issue2-1', '${childWithItemsId}', 'cl-issue2', '2026-04-13', '2026-04-15', 'Child Item', 'in-progress', 0, ${NOW}, ${NOW});
    `);

    const { extractClientRundown, resolveClient } = await import("./server");
    const cr = await resolveClient(testDb, "issue2-client");
    if (!cr.ok) throw new Error("resolveClient failed");

    const rundown = await extractClientRundown(
      testDb,
      cr.client,
      cr.topLevelProjects,
      "2026-04-15",
      "2026-04-15",
    );

    // The wrapper section is present.
    const wrapperSection = rundown.sections.find(
      (s) => s.kind === "wrapper" && s.title === "1H Wrapper",
    );
    expect(wrapperSection).toBeDefined();

    // The child-with-items section is present as its own wrapper-child.
    const childWithItemsSection = rundown.sections.find(
      (s) => s.kind === "wrapper-child" && s.title === "Child With Items",
    );
    expect(childWithItemsSection).toBeDefined();

    // The empty child is FILTERED OUT — no section block exists for it.
    const childEmptySection = rundown.sections.find(
      (s) => s.kind === "wrapper-child" && s.title === "Child Empty L1",
    );
    expect(childEmptySection).toBeUndefined();

    // BUT the empty child still appears in the wrapper's child rows
    // (the wrapper view's purpose is to show all L1 active periods,
    // including data-gap rows). The wrapper data's `raw.children` list
    // contains both children.
    if (wrapperSection && wrapperSection.data.raw.kind === "wrapper") {
      const childIds = wrapperSection.data.raw.children.map((c) => c.id);
      expect(childIds).toContain(childWithItemsId);
      expect(childIds).toContain(childEmptyId);
    }
  });
});
