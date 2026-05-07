/**
 * Track 4 Wave 4.5 — cross-tab integration tests.
 *
 * Locks in the contract that By Account and Gantt Charts route to two
 * different render paths and that collapse state does NOT persist across
 * tab switches (per Track 4 spec — persistence is explicitly deferred to
 * a future feature).
 *
 *   By Account tab    → AccountSection → AccountTier → CollapsibleSection
 *                       (CSS class: account-tier-details)
 *   Gantt Charts tab  → GanttChartsSection → slotted ganttContent
 *                       (CSS class on the dark embed: gantt-charts-details)
 *
 * Strategy: stub AccountSection and GanttChartsSection with thin shells
 * that surface the same CSS class markers the real implementations emit.
 * This keeps the test focused on RunwayBoard's tab routing without
 * depending on the full rundown fixture shape (ProjectRow / WeekItemRow
 * inferred from drizzle schema). The "real" markup is unit-tested in
 * the dedicated component tests already.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { RunwayBoard } from "./runway-board";
import {
  thisWeek,
  upcoming,
  accounts,
  pipeline,
} from "./runway-board-test-fixtures";
import type { DayItem } from "./types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./actions", () => ({
  toggleInFlightAction: async (next: boolean) => ({ inFlightToggle: next }),
  toggleNeedsUpdateAction: async (next: boolean) => ({ needsUpdateToggle: next }),
}));

// Stub AccountSection so we can probe collapse state without supplying a
// drizzle-schema-faithful rundown. The stub mirrors the real component's
// `account-tier-details` class and uses native <details> with defaultOpen,
// so toggling the summary closes the section just like the real tier.
vi.mock("./components/account-section", () => ({
  AccountSection: ({ account }: { account: { name: string; slug: string } }) => {
    // Match the real CollapsibleSection: native <details open> with the
    // `account-tier-details` class. Local React state tracks open/close so
    // the test can flip a section closed and verify default-open is reapplied
    // when the tab unmounts/remounts.
    const [open, setOpen] = useState(true);
    return (
      <details
        data-testid="account-section-stub"
        data-account-slug={account.slug}
        className="account-tier-details"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>{account.name}</summary>
        <div>body</div>
      </details>
    );
  },
}));

// Stub GanttChartsSection so we can verify the dark-embed render path
// is the one that fires on the Gantt Charts tab. The stub renders the
// same `gantt-charts-details` class the real RundownContentRSC emits.
vi.mock("./components/gantt-charts-section", () => ({
  GanttChartsSection: ({ accounts }: { accounts: Array<{ slug: string; name: string }> }) =>
    accounts.length === 0 ? (
      <div data-testid="gantt-charts-empty">empty</div>
    ) : (
      <div data-testid="gantt-charts-section-stub">
        {accounts.map((a) => (
          <details
            key={a.slug}
            className="gantt-charts-details"
            data-account-slug={a.slug}
            open
          >
            <summary>{a.name}</summary>
            <div>dark embed content</div>
          </details>
        ))}
      </div>
    ),
}));

// FlagsPanel + InFlightSection don't matter for these tests, but we stub
// them so they don't pull in their own dependencies.
vi.mock("./components/flags-panel", () => ({
  FlagsPanel: () => <div data-testid="flags-panel-stub" />,
}));
vi.mock("./components/in-flight-section", () => ({
  InFlightSection: () => <div data-testid="in-flight-section" />,
}));

const inFlightSource: DayItem[] = [...thisWeek, ...upcoming];

const defaultProps = {
  thisWeek,
  upcoming,
  accounts,
  pipeline,
  inFlightSource,
};

describe("RunwayBoard — cross-tab integration (Track 4 Wave 4.5)", () => {
  it("By Account tab renders AccountTier markup (account-tier-details)", () => {
    const { container } = render(<RunwayBoard {...defaultProps} />);
    fireEvent.click(screen.getByText("By Account"));

    const tierEls = container.querySelectorAll("details.account-tier-details");
    expect(tierEls.length).toBeGreaterThan(0);
    // And the dark Gantt embed is NOT mounted on this tab.
    expect(
      container.querySelector("details.gantt-charts-details"),
    ).toBeNull();
  });

  it("Gantt Charts tab renders the dark embed markup (gantt-charts-details)", () => {
    const { container } = render(<RunwayBoard {...defaultProps} />);
    fireEvent.click(screen.getByText("Gantt Charts"));

    const ganttEls = container.querySelectorAll("details.gantt-charts-details");
    expect(ganttEls.length).toBeGreaterThan(0);
    // And the AccountTier markup is NOT mounted on this tab.
    expect(
      container.querySelector("details.account-tier-details"),
    ).toBeNull();
  });

  // Track 4 Wave 4.5 — collapse state is independent per tab and does NOT
  // persist across tab switches (per spec — persistence is deferred to a
  // future feature). RunwayBoard renders each tab via a `view === ...`
  // branch, so switching tabs unmounts the previous tab's tree. When the
  // operator returns to By Account, every CollapsibleSection re-mounts at
  // its `defaultOpen` value. This test locks that behavior so a future
  // refactor that introduces tab-state persistence is forced to update it.
  it("collapse state does NOT persist across tab switches (sections re-default-open on remount)", () => {
    const { container } = render(<RunwayBoard {...defaultProps} />);
    fireEvent.click(screen.getByText("By Account"));

    // Default = open.
    const detailsBefore = container.querySelector(
      "details.account-tier-details",
    ) as HTMLDetailsElement;
    expect(detailsBefore).not.toBeNull();
    expect(detailsBefore.open).toBe(true);

    // Toggle it closed.
    fireEvent.click(detailsBefore.querySelector("summary")!);
    const detailsAfterToggle = container.querySelector(
      "details.account-tier-details",
    ) as HTMLDetailsElement;
    expect(detailsAfterToggle.open).toBe(false);

    // Switch away and back — the tab unmounts/remounts.
    fireEvent.click(screen.getByText("Gantt Charts"));
    expect(
      container.querySelector("details.account-tier-details"),
    ).toBeNull();

    fireEvent.click(screen.getByText("By Account"));

    const detailsAfterRemount = container.querySelector(
      "details.account-tier-details",
    ) as HTMLDetailsElement;
    expect(detailsAfterRemount).not.toBeNull();
    // Default-open is reapplied — the previous `false` did NOT persist.
    expect(detailsAfterRemount.open).toBe(true);
  });
});
