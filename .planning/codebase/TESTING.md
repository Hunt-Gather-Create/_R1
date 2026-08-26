# Testing Patterns

**Analysis Date:** 2026-08-04

## Test Framework

**Runner:**
- Vitest
- Config: `vitest.config.mts`
- Environment: `happy-dom` (browser-like DOM, lighter than jsdom)
- Globals: enabled (`describe`, `it`, `expect`, `vi` available without imports - though files still import explicitly for clarity)

**Assertion Library:**
- Vitest built-in (`expect`)
- `@testing-library/jest-dom` matchers loaded globally via `vitest.setup.mts`

**E2E Framework:**
- Playwright (config: `playwright.config.ts`)
- Test dir: `tests/runway/`
- Target: `https://runway.startround1.com` (production smoke, not local)
- Auth: stored state in `playwright/.auth/runway.json` after `auth.setup.ts` runs

**Run Commands:**
```bash
pnpm test          # Vitest watch mode
pnpm test:run      # Vitest single run (CI mode)
pnpm lint          # ESLint (separate gate)
# Playwright (manual, not in pnpm test):
npx playwright test
```

**Coverage:**
- No coverage thresholds configured in `vitest.config.mts`
- No `@vitest/coverage-*` package detected; coverage reporting is not enforced

## Test File Organization

**Location:**
- Unit/integration tests: co-located next to the source file they test
- `src/lib/foo.ts` → `src/lib/foo.test.ts`
- `src/app/runway/runway-board.tsx` → `src/app/runway/runway-board.test.tsx`
- Scripts: co-located in `scripts/` (e.g., `scripts/runway-gantt.test.ts`)
- Migration tests: co-located in `scripts/runway-migrations/`
- Fixtures: `tests/fixtures/` (shared sanitization helpers)
- Playwright smoke: `tests/runway/`

**Naming:**
- `*.test.ts` for pure TypeScript
- `*.test.tsx` for React components
- `*.spec.ts` for Playwright only

**Scale:**
- 177 unit/integration test files (`.test.ts` + `.test.tsx`)
- 31 `.test.tsx` (component tests); 146 `.test.ts` (utility/service tests)
- 2 Playwright spec files

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("featureName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // used when module-level cache must reset between tests
  });

  it("does the expected thing", async () => {
    // arrange
    // act
    // assert
  });
});
```

**Section separators** (common in larger test files):
```typescript
// ── Mock Setup ──────────────────────────────────────────
// ── Pure Utility Tests ──────────────────────────────────
// ── DB-Dependent Tests ──────────────────────────────────
```

**Patterns:**
- Factory functions (builder pattern) for fixtures - e.g., `createLabel()`, `createIssue()`, `leaf()` - always accept `Partial<T>` overrides
- `beforeEach` with `vi.clearAllMocks()` + `vi.resetModules()` when module cache isolation matters
- Dynamic imports (`await import("./module")`) used after `vi.mock()` declarations to pick up fresh module state

## Mocking

**Framework:** Vitest `vi.mock()` + `vi.fn()`

**Patterns:**

Chainable Drizzle ORM mock (used for DB-dependent action tests):
```typescript
function createDbMock() {
  let getResult: unknown = undefined;
  const chainable = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn().mockImplementation(() => getResult),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockImplementation(() => Promise.resolve(returningResult)),
    _setGetResult: (val: unknown) => { getResult = val; },
  };
  return chainable;
}
vi.mock("../db", () => ({ db: mockDb }));
```

Next.js router stub (global in `vitest.setup.mts`):
```typescript
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
```

Flat mock for simple dependencies:
```typescript
vi.mock("@/lib/db/runway-schema", () => ({
  clients: { name: "name", slug: "slug" },
  projects: { clientId: "clientId" },
}));
```

**What to Mock:**
- Database layer (Drizzle calls via `getRunwayDb()` or `db`)
- `next/navigation`, `next/headers`
- External service SDKs (WorkOS, Inngest, Slack)
- Server actions when testing React components

**What NOT to Mock:**
- Pure utility functions under test (tested directly)
- Type definitions and constants

## Fixtures and Factories

**Pattern:** Builder functions with `Partial<T>` override parameter:
```typescript
function createIssue(overrides: Partial<IssueWithLabels> = {}): IssueWithLabels {
  return {
    id: "issue-1",
    status: "todo",
    labels: [],
    createdAt: new Date(),
    // ... all required fields
    ...overrides,
  };
}
```

**Location:**
- Inline in each test file (most common)
- Shared fixtures in `tests/fixtures/` for cross-module helpers
- Large component fixture sets in separate `*-test-fixtures.ts` files (e.g., `src/app/runway/runway-board-test-fixtures.ts`)

## Coverage

**Requirements:** None enforced (no coverage thresholds in config)

**Approximate posture:**
- `src/lib/` utilities: roughly 50% of files have co-located tests (105 with tests, 99 without among `.ts` files)
- React components (`src/`): low coverage - 214 `.tsx` source files vs. 31 `.test.tsx` files (~14%)
- `scripts/` directory: well-tested; most scripts have co-located tests
- AI/LLM integration code (`src/lib/ai.ts`, `src/lib/chat/`): no tests detected

## Test Types

**Unit Tests:**
- Pure functions (filters, formatters, parsers, diff logic) tested directly
- No external dependencies; fast, deterministic

**Integration Tests:**
- DB-layer tests using chainable Drizzle mocks
- Slack bot and interactivity route tests (largest files: `route.test.ts` at 3,575 lines, `bot-tools.test.ts` at 1,455 lines)
- MCP tool tests (`src/lib/mcp/runway-tools.test.ts` at 1,289 lines)

**Component Tests (React Testing Library):**
- `render` + `screen` + `fireEvent` / `act`
- Server actions stubbed with `vi.mock()`
- Child components that involve complex rendering are also stubbed to isolate the component under test
- Example: `src/app/runway/runway-board.test.tsx`

**E2E / Smoke Tests (Playwright):**
- One spec file: `tests/runway/pr-104-smoke.spec.ts`
- Runs against live production URL, not localhost
- Heavy screenshot capture per test; DOM assertions are supplementary to visual review
- Auth via stored session state; `auth.setup.ts` handles login

## Common Patterns

**Async Testing:**
```typescript
it("returns null when session missing", async () => {
  const { getCurrentUser } = await import("./auth");
  const result = await getCurrentUser();
  expect(result).toBeNull();
});
```

**Error Testing:**
```typescript
it("re-throws DYNAMIC_SERVER_USAGE", async () => {
  const sentinel = Object.assign(new Error("DYNAMIC_SERVER_USAGE"), {
    digest: "DYNAMIC_SERVER_USAGE",
  });
  mockCookies.mockRejectedValue(sentinel);
  const { getCurrentUser } = await import("./auth");
  await expect(getCurrentUser()).rejects.toThrow(sentinel);
});
```

**React component with act():**
```typescript
await act(async () => {
  fireEvent.click(screen.getByRole("switch", { name: /in.flight/i }));
});
expect(mockToggleInFlight).toHaveBeenCalledWith(true);
```

---

*Testing analysis: 2026-08-04*
