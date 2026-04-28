import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the runway DB. The handler chains `.select(...).from(updates)` so
// we expose a select() that returns an object with `.from()` returning a
// thenable resolving to a [{ latest: Date | null }] row shape.
const mockSelect = vi.fn();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({ select: mockSelect }),
}));

describe("GET /api/runway/version", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSelect.mockReset();
  });

  it("returns the latest audit timestamp as ISO string when rows exist", async () => {
    const latest = new Date("2026-04-27T15:30:00.000Z");
    mockSelect.mockReturnValue({
      from: () => Promise.resolve([{ latest }]),
    });

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ version: latest.toISOString() });
  });

  it("returns null when the updates table is empty", async () => {
    mockSelect.mockReturnValue({
      from: () => Promise.resolve([{ latest: null }]),
    });

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ version: null });
  });

  it("returns null when the query returns no rows at all", async () => {
    mockSelect.mockReturnValue({
      from: () => Promise.resolve([]),
    });

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ version: null });
  });

  it("sets Cache-Control: no-store on the response", async () => {
    mockSelect.mockReturnValue({
      from: () => Promise.resolve([{ latest: new Date() }]),
    });

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it('exports dynamic = "force-dynamic" so Next.js opts the route out of static caching', async () => {
    const mod = await import("./route");

    expect((mod as { dynamic?: string }).dynamic).toBe("force-dynamic");
  });
});
