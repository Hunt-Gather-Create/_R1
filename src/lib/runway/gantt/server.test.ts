/**
 * Integration tests for generateGanttShare() in server.ts
 *
 * Uses the shared test-db seed harness (in-memory SQLite).
 * R2 is mocked — no real bucket touched.
 * RUNWAY_SHARE_SECRET is stubbed via vi.stubEnv.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
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
