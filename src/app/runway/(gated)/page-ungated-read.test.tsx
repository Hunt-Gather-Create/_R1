/**
 * The page is a server component under the gated layout, not a server
 * action. Its data load must not depend on the action gate, or a signed-out
 * visitor sees the gate error instead of the layout's redirect.
 * The real view-preferences modules and the real gate run here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));

vi.mock("../queries", () => ({
  getClientsWithProjects: vi.fn(async () => []),
  getWeekItems: vi.fn(async () => []),
  getPipeline: vi.fn(async () => []),
  getStaleWeekItems: vi.fn(async () => []),
}));
vi.mock("@/lib/runway/gantt/server", () => ({
  extractClientRundown: vi.fn(async () => ({ sections: [] })),
}));
vi.mock("../components/rundown-content-rsc", () => ({
  RundownContentRSC: () => null,
}));
vi.mock("../runway-board", () => ({
  RunwayBoard: () => null,
}));
vi.mock("@/lib/runway/flags", () => ({ analyzeFlags: vi.fn(() => []) }));
vi.mock("@/lib/db/runway", () => {
  // Every chain end resolves to no rows, awaited directly or through limit().
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(async () => []);
  chain.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
  return { getRunwayDb: vi.fn(() => chain) };
});
vi.mock("@/lib/db/runway-schema", () => ({
  clients: {},
  projects: {},
  viewPreferences: { scope: "scope", preferences: "preferences" },
}));

import RunwayPage from "./page";

beforeEach(() => {
  vi.stubEnv("RUNWAY_AUTH_SECRET", "test-secret-do-not-use-in-prod");
  vi.clearAllMocks();
  cookiesMock.mockResolvedValue({ get: vi.fn(() => undefined) });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("RunwayPage data load without a cookie", () => {
  it("loads view preferences without throwing the action gate error", async () => {
    await expect(RunwayPage()).resolves.toBeDefined();
  });
});
