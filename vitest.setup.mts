import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Global stub for next/navigation. Components like CompleteCheckbox call
// useRouter() at render time; without an App Router context jsdom/happy-dom
// throws. Tests that need to assert on router behaviour override this mock
// per-file (see src/app/runway/components/complete-checkbox.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
