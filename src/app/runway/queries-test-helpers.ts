/**
 * Shared mock setup and fixtures for Runway queries tests.
 */

import { vi } from "vitest";

export const mockResults: unknown[][] = [];
export let callIndex = 0;

export function resetMocks() {
  callIndex = 0;
  mockResults.length = 0;
}

export function createChainable() {
  const getResult = () => mockResults[callIndex++] ?? [];
  const chainable: Record<string, unknown> = {
    orderBy: vi.fn(() => createChainable()),
    where: vi.fn(() => createChainable()),
    then: (resolve: (v: unknown) => void) => resolve(getResult()),
  };
  return chainable;
}

// ── Shared Fixtures ──────────────────────────────────────

export const convergixClient = { id: "c1", name: "Convergix", slug: "convergix" };
export const lppcClient = { id: "c2", name: "LPPC", slug: "lppc" };

export const weekItemRows = [
  { date: "2026-04-06", dayOfWeek: "monday", title: "CDS Review", clientId: "c1", category: "review", owner: "Kathy", notes: null },
  { date: "2026-04-06", dayOfWeek: "monday", title: "Website Check", clientId: "c1", category: "delivery", owner: null, notes: "Final review" },
  { date: "2026-04-07", dayOfWeek: "tuesday", title: "LPPC Kickoff", clientId: null, category: "kickoff", owner: "Jason", notes: null },
];

export const pipelineRow = {
  id: "pl1", clientId: "c1", name: "New SOW", status: "sow-sent",
  estimatedValue: "$50,000", waitingOn: "Daniel", notes: null,
};

export const orphanPipelineRow = {
  id: "pl1", clientId: null, name: "Orphan SOW", status: "no-sow",
  estimatedValue: "TBD",
};

// ── Stale Week Items Fixtures ──────────────────────────────

export function createWeekItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "wi1",
    projectId: "p1",
    clientId: "c1",
    dayOfWeek: "monday",
    weekOf: "2026-04-06",
    date: "2026-04-06",
    title: "CDS Review",
    status: null,
    category: "review",
    owner: "Kathy",
    notes: null,
    sortOrder: 0,
    ...overrides,
  };
}

export function createUpdate(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    idempotencyKey: "key1",
    projectId: "p1",
    clientId: "c1",
    updatedBy: "Kathy",
    updateType: "status-change",
    previousValue: null,
    newValue: "completed",
    summary: "Done",
    slackMessageTs: null,
    createdAt: new Date("2026-04-06T14:00:00"),
    ...overrides,
  };
}
