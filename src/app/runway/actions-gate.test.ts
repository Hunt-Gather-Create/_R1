/**
 * Every server action in actions.ts must refuse a caller without a valid
 * Runway password cookie before it touches the database or a write helper.
 * The real gate runs here; only cookies() and the collaborators are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { cookiesMock, getRunwayDbMock, limitMock } = vi.hoisted(() => {
  const limitMock = vi.fn(async () => [] as unknown[]);
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: limitMock,
  };
  return { cookiesMock: vi.fn(), getRunwayDbMock: vi.fn(() => chain), limitMock };
});

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/runway", () => ({ getRunwayDb: getRunwayDbMock }));
vi.mock("@/lib/db/runway-schema", () => ({ weekItems: { id: "id" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((a, b) => ({ eq: [a, b] })) }));
vi.mock("@/lib/runway/view-preferences", () => ({
  setViewPreferences: vi.fn(async (patch: unknown) => patch),
}));
vi.mock("@/lib/runway/operations-writes-week", () => ({
  updateWeekItemField: vi.fn(async () => ({ ok: true })),
  linkWeekItemToProject: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/runway/operations-utils", () => ({
  getProjectsForClient: vi.fn(async () => []),
}));

import {
  toggleInFlightAction,
  toggleNeedsUpdateAction,
  setWeekItemStatusAction,
  updateWeekItemFieldsAction,
  listProjectsForWeekItemAction,
} from "./actions";
import { setViewPreferences } from "@/lib/runway/view-preferences";
import { updateWeekItemField } from "@/lib/runway/operations-writes-week";
import { getProjectsForClient } from "@/lib/runway/operations-utils";
import {
  RUNWAY_AUTH_COOKIE_NAME,
  signRunwayAuthCookie,
} from "@/lib/runway/auth-cookie";

const TEST_SECRET = "test-secret-do-not-use-in-prod";
const GATE_ERROR = "Runway gate: not signed in";

function makeCookieStore(cookieValue?: string) {
  return {
    get: vi.fn((name: string) =>
      name === RUNWAY_AUTH_COOKIE_NAME && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
    ),
  };
}

function tamperedCookie(): string {
  const [payload, mac] = signRunwayAuthCookie().split(".");
  const swapped = mac![0] === "A" ? "B" : "A";
  return `${payload}.${swapped}${mac!.slice(1)}`;
}

type Case = {
  name: string;
  call: () => Promise<unknown>;
  // A collaborator that the action reaches only after the gate lets it in.
  reached: () => unknown;
};

const cases: Case[] = [
  {
    name: "toggleInFlightAction",
    call: () => toggleInFlightAction(true),
    reached: () => vi.mocked(setViewPreferences),
  },
  {
    name: "toggleNeedsUpdateAction",
    call: () => toggleNeedsUpdateAction(false),
    reached: () => vi.mocked(setViewPreferences),
  },
  {
    name: "setWeekItemStatusAction",
    call: () =>
      setWeekItemStatusAction({
        weekItemId: "wi-1",
        newStatus: "completed",
        editorName: "Tester",
      }),
    reached: () => getRunwayDbMock,
  },
  {
    name: "updateWeekItemFieldsAction",
    call: () =>
      updateWeekItemFieldsAction({
        weekItemId: "wi-1",
        fields: {},
        updatedBy: "Tester",
      }),
    reached: () => getRunwayDbMock,
  },
  {
    name: "listProjectsForWeekItemAction",
    call: () => listProjectsForWeekItemAction({ weekItemId: "wi-1" }),
    reached: () => getRunwayDbMock,
  },
];

function expectNothingReached() {
  expect(getRunwayDbMock).not.toHaveBeenCalled();
  expect(limitMock).not.toHaveBeenCalled();
  expect(vi.mocked(setViewPreferences)).not.toHaveBeenCalled();
  expect(vi.mocked(updateWeekItemField)).not.toHaveBeenCalled();
  expect(vi.mocked(getProjectsForClient)).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubEnv("RUNWAY_AUTH_SECRET", TEST_SECRET);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(cases)("$name gate", ({ call, reached }) => {
  it("throws before any database call when no cookie is present", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(undefined));
    await expect(call()).rejects.toThrow(GATE_ERROR);
    expectNothingReached();
  });

  it("throws before any database call when the cookie is tampered", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(tamperedCookie()));
    await expect(call()).rejects.toThrow(GATE_ERROR);
    expectNothingReached();
  });

  it("reaches its existing behavior with a valid cookie", async () => {
    cookiesMock.mockResolvedValue(makeCookieStore(signRunwayAuthCookie()));
    await call();
    expect(reached()).toHaveBeenCalled();
  });
});
