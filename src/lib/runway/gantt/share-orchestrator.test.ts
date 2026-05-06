/**
 * Unit tests for share-orchestrator.ts — the thin re-export wrapper used by
 * MCP and Slack bot tools as the stable import path for generateGanttShare.
 *
 * The orchestrator file itself is a pure re-export of server.ts, but it is
 * the import surface that downstream tools mock by path. These tests:
 *
 * 1. Verify the re-export contract (function present, identity matches server).
 * 2. Verify happy-path behavior end-to-end through the orchestrator import
 *    (happy path, HMAC determinism for same input, distinct tokens for
 *    distinct inputs, R2 upload arg shape).
 * 3. Verify failure surfacing (R2 upload errors propagate).
 * 4. Verify URL composition under explicit origin / NEXT_PUBLIC_APP_URL /
 *    hardcoded fallback.
 *
 * Mocks:
 *   - @/lib/storage/r2-client.uploadContent   (no real R2 calls)
 *   - @/lib/db/runway.getRunwayDb             (returns in-memory test DB)
 *   - @/lib/runway/gantt/GanttTemplate        (returns predictable HTML;
 *                                              avoids logo file reads)
 *
 * RUNWAY_SHARE_SECRET is stubbed via vi.stubEnv so HMAC is deterministic
 * across test runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "@/lib/runway/test-db";

// ── Mocks (must be declared before importing module under test) ──

const mockUploadContent = vi.fn();
vi.mock("@/lib/storage/r2-client", () => ({
  uploadContent: mockUploadContent,
}));

let testDb: TestDb;
vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

vi.mock("@/lib/runway/gantt/GanttTemplate", () => ({
  renderGantt: vi.fn(() => "<html>gantt-project</html>"),
  renderClientRundown: vi.fn(() => "<html>client-rundown</html>"),
}));

const SECRET = "test-secret-for-orchestrator-tests-1234";

// ── Helpers ──

const STUB_R2_ENV = () => {
  vi.stubEnv("R2_ACCOUNT_ID", "test-account");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
};

describe("share-orchestrator — re-export contract", () => {
  it("exports generateGanttShare", async () => {
    const orchestrator = await import("./share-orchestrator");
    expect(orchestrator.generateGanttShare).toBeDefined();
    expect(typeof orchestrator.generateGanttShare).toBe("function");
  });

  it("re-exports the SAME generateGanttShare identity as server.ts", async () => {
    const orchestrator = await import("./share-orchestrator");
    const server = await import("./server");
    expect(orchestrator.generateGanttShare).toBe(server.generateGanttShare);
  });
});

describe("share-orchestrator — generateGanttShare end-to-end", () => {
  let libsqlClient: Client;
  let dbPath: string;

  beforeEach(async () => {
    vi.stubEnv("RUNWAY_SHARE_SECRET", SECRET);
    STUB_R2_ENV();

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

  describe("happy path", () => {
    it("returns shareUrl, expiresAt, and summary when called via orchestrator", async () => {
      const { generateGanttShare } = await import("./share-orchestrator");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });

      expect(result.shareUrl).toMatch(
        /^https:\/\/runway\.startround1\.com\/api\/runway\/gantt-share\/[A-Za-z0-9_\-.]+$/,
      );
      expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.summary.kind).toBe("client");
      expect(result.summary.clientName).toBe("Convergix");
      expect(result.summary.severity).toEqual(
        expect.objectContaining({
          critical: expect.any(Number),
          warn: expect.any(Number),
          info: expect.any(Number),
        }),
      );
    });

    it("expiresAt is ~7 days in the future by default", async () => {
      const { generateGanttShare } = await import("./share-orchestrator");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });

      const expiry = Date.parse(result.expiresAt);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      // Allow a 60s slack for slow CI
      expect(expiry).toBeGreaterThan(Date.now() + sevenDaysMs - 60_000);
      expect(expiry).toBeLessThan(Date.now() + sevenDaysMs + 60_000);
    });

    it("respects custom ttlDays", async () => {
      const { generateGanttShare } = await import("./share-orchestrator");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
        ttlDays: 30,
      });

      const expiry = Date.parse(result.expiresAt);
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(expiry).toBeGreaterThan(Date.now() + thirtyDaysMs - 60_000);
      expect(expiry).toBeLessThan(Date.now() + thirtyDaysMs + 60_000);
    });
  });

  describe("HMAC token consistency", () => {
    it("two distinct calls produce distinct tokens (nonce + timestamp differ)", async () => {
      const { generateGanttShare } = await import("./share-orchestrator");

      const a = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });
      const b = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });

      const tokenA = a.shareUrl.split("/api/runway/gantt-share/")[1];
      const tokenB = b.shareUrl.split("/api/runway/gantt-share/")[1];

      expect(tokenA).toBeTruthy();
      expect(tokenB).toBeTruthy();
      // Different nonce → different payload → different token
      expect(tokenA).not.toBe(tokenB);
    });

    it("token from orchestrator round-trips through verifyToken", async () => {
      const { generateGanttShare } = await import("./share-orchestrator");
      const { verifyToken } = await import("./share-token");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });

      const token = result.shareUrl.split("/api/runway/gantt-share/")[1];
      expect(token).toBeTruthy();

      const verification = verifyToken(token!);
      expect(verification.ok).toBe(true);
      if (!verification.ok) throw new Error("unreachable");
      expect(verification.payload.clientSlug).toBe("convergix");
      expect(verification.payload.theme).toBe("light-branded");
      expect(verification.payload.kind).toBe("client");
      expect(verification.payload.v).toBe(1);
    });

    it("token's nonce matches the R2 storage key nonce (consistency)", async () => {
      const { generateGanttShare } = await import("./share-orchestrator");
      const { verifyToken } = await import("./share-token");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });

      const token = result.shareUrl.split("/api/runway/gantt-share/")[1]!;
      const verification = verifyToken(token);
      if (!verification.ok) throw new Error("token did not verify");
      const tokenNonce = verification.payload.nonce;

      // R2 upload was called with key gantt-share/{nonce}/render.html
      expect(mockUploadContent).toHaveBeenCalledTimes(1);
      const [storageKey] = mockUploadContent.mock.calls[0] as [string];
      expect(storageKey).toBe(`gantt-share/${tokenNonce}/render.html`);
    });
  });

  describe("R2 upload arguments", () => {
    it("upload is called with key, html content, content-type, and metadata", async () => {
      const { generateGanttShare } = await import("./share-orchestrator");

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

      expect(storageKey).toMatch(
        /^gantt-share\/[A-Za-z0-9_-]+\/render\.html$/,
      );
      expect(content).toBe("<html>client-rundown</html>");
      expect(contentType).toBe("text/html; charset=utf-8");
      expect(metadata["client-slug"]).toBe("convergix");
      expect(metadata["kind"]).toBe("client");
      expect(metadata["theme"]).toBe("light-branded");
      expect(typeof metadata["expires-at"]).toBe("string");
      expect(Date.parse(metadata["expires-at"]!)).not.toBeNaN();
    });
  });

  describe("R2 upload failure surfacing", () => {
    it("propagates the rejection from uploadContent", async () => {
      mockUploadContent.mockRejectedValueOnce(new Error("R2 upload failed: timeout"));
      const { generateGanttShare } = await import("./share-orchestrator");

      await expect(
        generateGanttShare({
          clientSlug: "convergix",
          theme: "light-branded",
        }),
      ).rejects.toThrow("R2 upload failed: timeout");
    });

    it("does not return a shareUrl when R2 upload fails", async () => {
      mockUploadContent.mockRejectedValueOnce(new Error("network down"));
      const { generateGanttShare } = await import("./share-orchestrator");

      let result: unknown = null;
      try {
        result = await generateGanttShare({
          clientSlug: "convergix",
          theme: "light-branded",
        });
      } catch {
        // expected
      }
      expect(result).toBeNull();
    });
  });

  describe("R2 not-configured fail-fast", () => {
    it("throws before any DB or upload work when R2 env vars are missing", async () => {
      vi.stubEnv("R2_ACCOUNT_ID", "");
      vi.resetModules();
      const { generateGanttShare } = await import("./share-orchestrator");

      await expect(
        generateGanttShare({
          clientSlug: "convergix",
          theme: "light-branded",
        }),
      ).rejects.toThrow(/R2 not configured/);

      // Upload should never have been attempted
      expect(mockUploadContent).not.toHaveBeenCalled();
    });
  });

  describe("URL composition", () => {
    it("uses input.origin when provided (highest priority)", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.com");
      vi.resetModules();
      const { generateGanttShare } = await import("./share-orchestrator");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
        origin: "https://explicit.example.com",
      });

      expect(result.shareUrl).toMatch(
        /^https:\/\/explicit\.example\.com\/api\/runway\/gantt-share\//,
      );
    });

    it("falls back to NEXT_PUBLIC_APP_URL when origin is not provided", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.com");
      vi.resetModules();
      const { generateGanttShare } = await import("./share-orchestrator");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });

      expect(result.shareUrl).toMatch(
        /^https:\/\/staging\.example\.com\/api\/runway\/gantt-share\//,
      );
    });

    it("falls back to runway.startround1.com when neither origin nor NEXT_PUBLIC_APP_URL is set", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      vi.resetModules();
      const { generateGanttShare } = await import("./share-orchestrator");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
      });

      expect(result.shareUrl).toMatch(
        /^https:\/\/runway\.startround1\.com\/api\/runway\/gantt-share\//,
      );
    });

    it("appends the token after /api/runway/gantt-share/ regardless of origin", async () => {
      const { generateGanttShare } = await import("./share-orchestrator");

      const result = await generateGanttShare({
        clientSlug: "convergix",
        theme: "light-branded",
        origin: "https://custom.example.org",
      });

      const prefix = "https://custom.example.org/api/runway/gantt-share/";
      expect(result.shareUrl.startsWith(prefix)).toBe(true);

      const token = result.shareUrl.slice(prefix.length);
      // Token format: <base64url>.<base64url>
      expect(token.split(".")).toHaveLength(2);
    });
  });

  describe("client resolution failure", () => {
    it("throws with available slugs when client is not found", async () => {
      const { generateGanttShare } = await import("./share-orchestrator");

      await expect(
        generateGanttShare({
          clientSlug: "does-not-exist",
          theme: "light-branded",
        }),
      ).rejects.toThrow(/Client not found.*does-not-exist/);
    });
  });
});
