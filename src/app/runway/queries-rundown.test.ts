/**
 * Unit tests for queries-rundown.ts.
 *
 * Strategy:
 *  - Mock `getRunwayDb` so the .select().from().orderBy() chain returns a
 *    deterministic client list.
 *  - Mock `global.fetch` per-test for happy / error paths. No real network.
 *  - Assert URL composition (encodes clientId, uses correct base URL),
 *    header propagation (RUNWAY_EMBED_SECRET → x-embed-secret), error
 *    paths (non-OK, throw, malformed JSON), and the final Map shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────

const mockClientList: { id: string; name: string }[] = [];

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => ({
    select: () => ({
      from: () => ({
        orderBy: () => Promise.resolve(mockClientList),
      }),
    }),
  }),
}));

vi.mock("@/lib/db/runway-schema", () => ({
  clients: { name: "clients-name", id: "clients-id" },
}));

vi.mock("drizzle-orm", () => ({
  asc: (col: unknown) => ({ asc: col }),
}));

// ── Helpers ──────────────────────────────────────────────

function setClients(list: { id: string; name: string }[]) {
  mockClientList.length = 0;
  mockClientList.push(...list);
}

function makeResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function sampleRundown(generatedAt = "2026-05-05T00:00:00.000Z") {
  return {
    generatedAt,
    overallSeverity: { critical: 0, warn: 0, info: 0 },
    sections: [
      { anchor: "anchor-1", kind: "standalone" as const, title: "Section 1" },
    ],
  };
}

// ── Test setup ───────────────────────────────────────────

const originalEnv = { ...process.env };
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setClients([]);
  vi.resetModules();
  // Wipe relevant env vars for predictable getBaseUrl behavior
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.VERCEL_URL;
  delete process.env.RUNWAY_EMBED_SECRET;
  // Stub a default fetch so untracked usage is obvious.
  fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(makeResponse({}));
});

afterEach(() => {
  fetchSpy.mockRestore();
  // Restore env
  for (const k of Object.keys(process.env)) {
    if (!(k in originalEnv)) delete process.env[k];
  }
  for (const k of Object.keys(originalEnv)) {
    process.env[k] = originalEnv[k];
  }
});

// ── Tests ────────────────────────────────────────────────

describe("getClientRundowns — happy path", () => {
  it("returns an empty Map when there are no clients", async () => {
    setClients([]);
    fetchSpy.mockResolvedValue(makeResponse(sampleRundown()));

    const { getClientRundowns } = await import("./queries-rundown");
    const result = await getClientRundowns();

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches per client and keys the Map by client.id", async () => {
    setClients([
      { id: "c1", name: "Aardvark" },
      { id: "c2", name: "Buffalo" },
    ]);
    const r1 = sampleRundown("2026-05-05T01:00:00.000Z");
    const r2 = sampleRundown("2026-05-05T02:00:00.000Z");

    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("clientId=c1")) return makeResponse(r1);
      if (url.includes("clientId=c2")) return makeResponse(r2);
      return makeResponse({}, { ok: false, status: 404 });
    });

    const { getClientRundowns } = await import("./queries-rundown");
    const result = await getClientRundowns();

    expect(result.size).toBe(2);
    expect(result.get("c1")).toEqual(r1);
    expect(result.get("c2")).toEqual(r2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("URL-encodes the clientId query param", async () => {
    setClients([{ id: "c with/space&amp", name: "Edgey" }]);
    fetchSpy.mockResolvedValue(makeResponse(sampleRundown()));

    const { getClientRundowns } = await import("./queries-rundown");
    await getClientRundowns();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    // encodeURIComponent of "c with/space&amp"
    expect(calledUrl).toContain(`clientId=${encodeURIComponent("c with/space&amp")}`);
    // sanity: should not contain the raw string unencoded
    expect(calledUrl).not.toContain("clientId=c with/space&amp");
  });

  it("uses NEXT_PUBLIC_APP_URL as the base URL when set", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://runway.example.com";
    setClients([{ id: "c1", name: "Aardvark" }]);
    fetchSpy.mockResolvedValue(makeResponse(sampleRundown()));

    const { getClientRundowns } = await import("./queries-rundown");
    await getClientRundowns();

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/^https:\/\/runway\.example\.com\/api\/runway\/gantt-embed\?clientId=c1$/);
  });

  it("falls back to https://${VERCEL_URL} when NEXT_PUBLIC_APP_URL is unset", async () => {
    process.env.VERCEL_URL = "preview-abcdef.vercel.app";
    setClients([{ id: "c1", name: "Aardvark" }]);
    fetchSpy.mockResolvedValue(makeResponse(sampleRundown()));

    const { getClientRundowns } = await import("./queries-rundown");
    await getClientRundowns();

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl.startsWith("https://preview-abcdef.vercel.app/")).toBe(true);
  });

  it("falls back to http://localhost:3000 when no env vars set", async () => {
    setClients([{ id: "c1", name: "Aardvark" }]);
    fetchSpy.mockResolvedValue(makeResponse(sampleRundown()));

    const { getClientRundowns } = await import("./queries-rundown");
    await getClientRundowns();

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl.startsWith("http://localhost:3000/")).toBe(true);
  });

  it("attaches x-embed-secret header when RUNWAY_EMBED_SECRET is set", async () => {
    process.env.RUNWAY_EMBED_SECRET = "shh-its-a-secret";
    setClients([{ id: "c1", name: "Aardvark" }]);
    fetchSpy.mockResolvedValue(makeResponse(sampleRundown()));

    const { getClientRundowns } = await import("./queries-rundown");
    await getClientRundowns();

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-embed-secret"]).toBe("shh-its-a-secret");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("omits x-embed-secret header when RUNWAY_EMBED_SECRET is unset", async () => {
    setClients([{ id: "c1", name: "Aardvark" }]);
    fetchSpy.mockResolvedValue(makeResponse(sampleRundown()));

    const { getClientRundowns } = await import("./queries-rundown");
    await getClientRundowns();

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-embed-secret"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("uses cache: 'no-store' on every fetch", async () => {
    setClients([{ id: "c1", name: "Aardvark" }]);
    fetchSpy.mockResolvedValue(makeResponse(sampleRundown()));

    const { getClientRundowns } = await import("./queries-rundown");
    await getClientRundowns();

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.cache).toBe("no-store");
  });
});

describe("getClientRundowns — error paths", () => {
  it("logs and skips a client when the fetch returns non-OK status", async () => {
    setClients([
      { id: "c1", name: "Aardvark" },
      { id: "c2", name: "Buffalo" },
    ]);
    const r2 = sampleRundown();
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("clientId=c1")) {
        return makeResponse({ error: "boom" }, { ok: false, status: 500 });
      }
      return makeResponse(r2);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getClientRundowns } = await import("./queries-rundown");
    const result = await getClientRundowns();

    expect(result.size).toBe(1);
    expect(result.has("c1")).toBe(false);
    expect(result.get("c2")).toEqual(r2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[queries-rundown] gantt-embed fetch failed for c1: HTTP 500"),
    );

    errorSpy.mockRestore();
  });

  it("logs and skips a client when fetch throws (network error)", async () => {
    setClients([
      { id: "c1", name: "Aardvark" },
      { id: "c2", name: "Buffalo" },
    ]);
    const r2 = sampleRundown();
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("clientId=c1")) {
        throw new Error("ECONNRESET");
      }
      return makeResponse(r2);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getClientRundowns } = await import("./queries-rundown");
    const result = await getClientRundowns();

    expect(result.size).toBe(1);
    expect(result.has("c1")).toBe(false);
    expect(result.get("c2")).toEqual(r2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[queries-rundown] gantt-embed fetch threw for c1:"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  it("logs and skips a client when JSON body is malformed", async () => {
    setClients([{ id: "c1", name: "Aardvark" }]);
    const malformedResponse = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response;
    fetchSpy.mockResolvedValue(malformedResponse);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getClientRundowns } = await import("./queries-rundown");
    const result = await getClientRundowns();

    expect(result.size).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[queries-rundown] gantt-embed fetch threw for c1:"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  it("returns an empty Map when every client fetch fails", async () => {
    setClients([
      { id: "c1", name: "Aardvark" },
      { id: "c2", name: "Buffalo" },
    ]);
    fetchSpy.mockResolvedValue(makeResponse({}, { ok: false, status: 503 }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getClientRundowns } = await import("./queries-rundown");
    const result = await getClientRundowns();

    expect(result.size).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(2);

    errorSpy.mockRestore();
  });

  it("isolates per-client failures (one fails, the rest succeed)", async () => {
    setClients([
      { id: "c1", name: "Aardvark" },
      { id: "c2", name: "Buffalo" },
      { id: "c3", name: "Cougar" },
    ]);
    const r1 = sampleRundown("2026-05-05T01:00:00.000Z");
    const r3 = sampleRundown("2026-05-05T03:00:00.000Z");
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("clientId=c1")) return makeResponse(r1);
      if (url.includes("clientId=c2")) throw new Error("flaky");
      return makeResponse(r3);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getClientRundowns } = await import("./queries-rundown");
    const result = await getClientRundowns();

    expect(result.size).toBe(2);
    expect(result.get("c1")).toEqual(r1);
    expect(result.has("c2")).toBe(false);
    expect(result.get("c3")).toEqual(r3);

    errorSpy.mockRestore();
  });
});
