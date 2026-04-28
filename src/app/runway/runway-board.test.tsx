import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { RunwayBoard } from "./runway-board";
import { mergeWeekendDays, groupByWeek } from "./runway-board-utils";
import { thisWeek, upcoming, accounts, pipeline } from "./runway-board-test-fixtures";
import type { DayItem } from "./types";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// Stub the server action so client tests don't try to cross module boundary.
const mockToggleInFlight = vi.fn<(next: boolean) => Promise<{ inFlightToggle: boolean }>>(
  async (next: boolean) => ({ inFlightToggle: next })
);
vi.mock("./actions", () => ({
  toggleInFlightAction: (next: boolean) => mockToggleInFlight(next),
}));

// Stub InFlightSection so we can assert which weekItems source it received
// without coupling to its internal filterInFlight logic. The testid mirrors
// the real component's so document-order tests work against the same handle.
vi.mock("./components/in-flight-section", () => ({
  InFlightSection: ({ weekItems, enabled }: { weekItems: DayItem[]; enabled: boolean }) => (
    <div
      data-testid="in-flight-section"
      data-week-items={JSON.stringify(weekItems)}
      data-enabled={String(enabled)}
    />
  ),
}));

const inFlightSource: DayItem[] = [
  ...thisWeek,
  ...upcoming,
  {
    date: "2026-04-20",
    label: "Mon 4/20",
    items: [
      { title: "Past-Monday In-Progress", account: "OldClient", type: "delivery" },
    ],
  },
];

const defaultProps = { thisWeek, upcoming, accounts, pipeline, inFlightSource };

/** Helper: stub a fetch sequence returning the given version values in order. */
function mockVersionFetch(versions: Array<string | null>) {
  const fetch = vi.fn(async () => {
    const v = versions.shift() ?? null;
    return new Response(JSON.stringify({ version: v }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flushPromises() {
  // Each pending microtask. We loop a few times because awaiting fetch().json()
  // chains a few microtasks before the version comparison runs.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("RunwayBoard", () => {
  it("renders the header", () => {
    render(<RunwayBoard {...defaultProps} />);
    expect(screen.getByText("Civilization Runway")).toBeInTheDocument();
  });

  it("shows This Week view by default", () => {
    render(<RunwayBoard {...defaultProps} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText(/Upcoming/)).toBeInTheDocument();
  });

  it("switches to accounts view when tab is clicked", () => {
    render(<RunwayBoard {...defaultProps} />);
    fireEvent.click(screen.getByText("By Account"));
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("CDS Messaging")).toBeInTheDocument();
  });

  it("switches to pipeline view when tab is clicked", () => {
    render(<RunwayBoard {...defaultProps} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("Unsigned SOWs & New Business")).toBeInTheDocument();
    expect(screen.getByText("New SOW")).toBeInTheDocument();
    expect(screen.getByText("$50,000+")).toBeInTheDocument();
  });

  it("renders upcoming day columns", () => {
    render(<RunwayBoard {...defaultProps} />);
    expect(screen.getByText("Future Item")).toBeInTheDocument();
  });

  it("renders all three tab buttons", () => {
    render(<RunwayBoard {...defaultProps} />);
    const buttons = screen.getAllByRole("button");
    const buttonLabels = buttons.map((b) => b.textContent);
    expect(buttonLabels).toContain("This Week");
    expect(buttonLabels).toContain("By Account");
    expect(buttonLabels).toContain("Pipeline");
  });

  it("switches back to triage view from another tab", () => {
    render(<RunwayBoard {...defaultProps} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("Unsigned SOWs & New Business")).toBeInTheDocument();

    fireEvent.click(screen.getByText("This Week"));
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText(/Upcoming/)).toBeInTheDocument();
  });

  it("calculates pipeline total correctly, skipping TBD", () => {
    const mixedPipeline = [
      { account: "A", title: "SOW 1", value: "$50,000", status: "sow-sent" as const },
      { account: "B", title: "SOW 2", value: "TBD", status: "drafting" as const },
      { account: "C", title: "SOW 3", value: "$25,000", status: "verbal" as const },
    ];
    render(<RunwayBoard {...defaultProps} pipeline={mixedPipeline} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("$75,000+")).toBeInTheDocument();
  });

  it("shows $0+ when all pipeline values are TBD", () => {
    const tbdPipeline = [
      { account: "A", title: "SOW 1", value: "TBD", status: "at-risk" as const },
    ];
    render(<RunwayBoard {...defaultProps} pipeline={tbdPipeline} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("$0+")).toBeInTheDocument();
  });

  it("handles pipeline values with non-numeric characters", () => {
    const oddPipeline = [
      { account: "A", title: "SOW 1", value: "$100,000", status: "sow-sent" as const },
      { account: "B", title: "SOW 2", value: "Approx $50K", status: "verbal" as const },
    ];
    render(<RunwayBoard {...defaultProps} pipeline={oddPipeline} />);
    fireEvent.click(screen.getByText("Pipeline"));
    // "Approx $50K" → parseInt on "50" after removing $ and , = NaN → treated as 0
    expect(screen.getByText("$100,000+")).toBeInTheDocument();
  });

  it("hides This Week section when restOfWeek is empty", () => {
    // Use local date to match how the component detects "today"
    const now = new Date();
    const localISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const todayOnly: typeof thisWeek = [
      {
        date: localISO,
        label: "Mon 4/6",
        items: [{ title: "Today Thing", account: "Test", type: "delivery" }],
      },
    ];
    const { container } = render(
      <RunwayBoard {...defaultProps} thisWeek={todayOnly} />
    );
    // "This Week" heading should not appear (only Today and Upcoming)
    const headings = Array.from(container.querySelectorAll("h2")).map(
      (h) => h.textContent
    );
    expect(headings).not.toContain("This Week");
  });

  it("applies active styling to selected tab", () => {
    render(<RunwayBoard {...defaultProps} />);
    const buttons = screen.getAllByRole("button");
    const thisWeekButton = buttons.find((b) => b.textContent === "This Week")!;
    expect(thisWeekButton.className).toContain("bg-foreground/10");
    const pipelineButton = buttons.find((b) => b.textContent === "Pipeline")!;
    expect(pipelineButton.className).not.toContain("bg-foreground/10");
  });

  it("renders empty pipeline view with no items", () => {
    render(<RunwayBoard {...defaultProps} pipeline={[]} />);
    fireEvent.click(screen.getByText("Pipeline"));
    expect(screen.getByText("$0+")).toBeInTheDocument();
  });

  it("renders empty accounts view with no accounts", () => {
    render(<RunwayBoard {...defaultProps} accounts={[]} />);
    fireEvent.click(screen.getByText("By Account"));
    // Should not crash, just render empty
    expect(screen.queryByText("Convergix")).not.toBeInTheDocument();
  });

  // Regression-lock: passes `inFlightSource` (NOT `allWeekItems`) to
  // <InFlightSection>. The bug was that page.tsx's pre-bucketing dropped
  // past-Monday day buckets; InFlightSection silently rendered nothing in
  // prod despite real in-progress items. inFlightSource is built from the
  // full unfiltered fetch, so this prop is the wire from "all items" to
  // "in flight rendering."
  it("passes inFlightSource (not allWeekItems) to InFlightSection", () => {
    render(<RunwayBoard {...defaultProps} />);
    const stub = screen.getByTestId("in-flight-section");
    const passed = JSON.parse(stub.getAttribute("data-week-items")!);
    expect(passed).toEqual(inFlightSource);
    // Sanity check the regression: passed source contains the past-Monday
    // bucket that bucketing would have dropped.
    const dates = passed.map((d: DayItem) => d.date);
    expect(dates).toContain("2026-04-20");
  });

  // Chunk 3 #6: In Flight toggle default ON + persistence hook
  // (Toggle was extracted to InFlightToggle component in PR #88 chunk A.)
  it("renders In Flight toggle on by default", () => {
    render(<RunwayBoard {...defaultProps} />);
    const toggle = screen.getByTestId("in-flight-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("respects initialInFlightEnabled=false when explicitly off", () => {
    render(
      <RunwayBoard {...defaultProps} initialInFlightEnabled={false} />
    );
    const toggle = screen.getByTestId("in-flight-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("flips toggle state and invokes server action on change", () => {
    mockToggleInFlight.mockClear();
    render(<RunwayBoard {...defaultProps} />);
    const toggle = screen.getByTestId("in-flight-toggle");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(mockToggleInFlight).toHaveBeenCalledWith(false);
  });

  // The TV dashboard runs continuously for days. todayStr was previously
  // memoized at mount, so the "Today" indicator silently went stale at
  // midnight. Confirm a re-render after midnight picks up the new day.
  it("today indicator advances when system clock crosses midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T23:59:59"));

    const week: DayItem[] = [
      {
        date: "2026-04-06",
        label: "Mon 4/6",
        items: [{ title: "Monday Item", account: "Acme", type: "delivery" }],
      },
      {
        date: "2026-04-07",
        label: "Tue 4/7",
        items: [{ title: "Tuesday Item", account: "Acme", type: "delivery" }],
      },
    ];

    const { rerender } = render(
      <RunwayBoard {...defaultProps} thisWeek={week} />
    );

    const todaySectionBefore = screen.getByText("Today").closest("section")!;
    expect(within(todaySectionBefore).getByText("Monday Item")).toBeInTheDocument();
    expect(within(todaySectionBefore).queryByText("Tuesday Item")).toBeNull();

    vi.setSystemTime(new Date("2026-04-07T00:00:30"));
    rerender(<RunwayBoard {...defaultProps} thisWeek={week} />);

    const todaySectionAfter = screen.getByText("Today").closest("section")!;
    expect(within(todaySectionAfter).getByText("Tuesday Item")).toBeInTheDocument();
    expect(within(todaySectionAfter).queryByText("Monday Item")).toBeNull();

    vi.useRealTimers();
  });

  // Section reorder (2026-04-28): Today moved above In Flight so the operator's
  // first-glance view matches the actual reading order. Locks the new order so
  // future edits don't silently regress it.
  it("renders triage sections in document order: needs-update, today, in-flight, this-week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T12:00:00")); // Monday

    const orderFixture = {
      thisWeek: [
        // today-dated bucket → todayColumn populated
        {
          date: "2026-04-06",
          label: "Mon 4/6",
          items: [{ title: "Today Item", account: "X", type: "delivery" as const }],
        },
        // non-today bucket → restOfWeek > 0 → ThisWeek section renders
        {
          date: "2026-04-08",
          label: "Wed 4/8",
          items: [{ title: "Wed Item", account: "X", type: "delivery" as const }],
        },
      ],
      upcoming: [],
      accounts: [],
      pipeline: [],
      staleItems: [
        {
          date: "2026-03-30",
          label: "Mon 3/30",
          items: [{ title: "Stale", account: "X", type: "delivery" as const }],
        },
      ],
      inFlightSource: [
        {
          date: "2026-04-06",
          label: "Mon 4/6",
          items: [
            {
              title: "Live",
              account: "X",
              type: "delivery" as const,
              status: "in-progress",
              startDate: "2026-04-01",
              endDate: "2026-05-31",
            },
          ],
        },
      ],
    };

    render(<RunwayBoard {...orderFixture} />);

    const order = [
      "needs-update-section",
      "today-section",
      "in-flight-section",
      "this-week-section",
    ];
    const elements = order.map((id) => screen.getByTestId(id));

    for (let i = 1; i < elements.length; i++) {
      const relation = elements[i - 1].compareDocumentPosition(elements[i]);
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    vi.useRealTimers();
  });
});

describe("RunwayBoard version polling", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRefresh.mockClear();
    vi.useFakeTimers();
    setVisibility("visible");
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    consoleErrorSpy.mockRestore();
  });

  it("fetches /api/runway/version once on mount and does not refresh on baseline response", async () => {
    const fetch = mockVersionFetch(["v1"]);
    render(<RunwayBoard {...defaultProps} />);

    // Mount-time fetch fires synchronously inside the effect.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/runway/version", expect.any(Object));

    await act(async () => {
      await flushPromises();
    });

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("calls router.refresh after 15s when version changed", async () => {
    mockVersionFetch(["v1", "v2"]);
    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT call router.refresh when version is unchanged", async () => {
    mockVersionFetch(["v1", "v1", "v1"]);
    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("pauses polling while document.visibilityState is hidden", async () => {
    const fetch = mockVersionFetch(["v1", "v2", "v3", "v4"]);
    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    // Hide the tab — interval pauses.
    await act(async () => {
      setVisibility("hidden");
      await flushPromises();
    });

    // Advance well past 15s; no extra fetches should fire.
    await act(async () => {
      vi.advanceTimersByTime(60 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("on visibility return to visible: fires one fetch immediately, then resumes the interval", async () => {
    const fetch = mockVersionFetch(["v1", "v2", "v2", "v2"]);
    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      setVisibility("hidden");
      await flushPromises();
    });

    // Become visible — one immediate fetch.
    await act(async () => {
      setVisibility("visible");
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    // That fetch saw v2 vs baseline v1 → triggers refresh.
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // Then the resumed interval ticks once at 15s — no double-fire.
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(3);

    // Verify it doesn't double-fire from a leftover pre-pause timer:
    // total fetches at 15s should be exactly 3, not 4+.
    await act(async () => {
      vi.advanceTimersByTime(1);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("logs once and continues polling on a single non-fatal non-OK response", async () => {
    // 500 is a transient failure, NOT an auth expiry — polling should
    // resume on the next tick and the failure counter should reset
    // when the next response succeeds. (302/401 trip stale immediately;
    // see the dedicated auth-expiry tests below.)
    let call = 0;
    const fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response("upstream blew up", { status: 500 });
      }
      return new Response(JSON.stringify({ version: "v2" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    // Polling continues — next tick still fires.
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    // Now baseline=null (first response failed), version="v2" → first
    // successful response sets the baseline; should NOT refresh.
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("logs once and continues polling when response.json() throws", async () => {
    let call = 0;
    const fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response("not-json-body", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ version: "v1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // --- Staleness behavior (loop-stop + chip + log-once) ---

  /** Helper: stub fetch returning the given Response factories in order. */
  function mockFetchSequence(
    responses: Array<() => Response>
  ): ReturnType<typeof vi.fn> {
    let idx = 0;
    const fetch = vi.fn(async () => {
      const factory = responses[idx];
      idx += 1;
      return factory
        ? factory()
        : new Response(JSON.stringify({ version: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const STALE_TEXT = "Live updates paused — refresh to reconnect";
  const errorBody = (status: number) => () =>
    new Response("err", { status });
  const okBody = (version: string | null) => () =>
    new Response(JSON.stringify({ version }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("stops polling and renders staleness chip after 3 consecutive non-OK responses", async () => {
    const fetch = mockFetchSequence([
      errorBody(500),
      errorBody(500),
      errorBody(500),
      okBody("vX"),
    ]);

    render(<RunwayBoard {...defaultProps} />);
    // Mount-time fetch (call #1).
    await act(async () => {
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(STALE_TEXT)).toBeNull();

    // Tick 2 (call #2) — second consecutive failure.
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(STALE_TEXT)).toBeNull();

    // Tick 3 (call #3) — third consecutive failure → trips threshold.
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByText(STALE_TEXT)).toBeInTheDocument();

    // Further interval ticks must NOT fire additional fetches.
    await act(async () => {
      vi.advanceTimersByTime(60 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("stops polling and renders staleness chip immediately on a single 401 response", async () => {
    const fetch = mockFetchSequence([errorBody(401), okBody("vX")]);

    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(STALE_TEXT)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops polling and renders staleness chip immediately on a single 302 response", async () => {
    const fetch = mockFetchSequence([errorBody(302), okBody("vX")]);

    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(STALE_TEXT)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("resets the failure counter after a successful response (no chip until 3 NEW consecutive failures)", async () => {
    // seed-success, fail, fail, success (resets), fail, fail, fail (trips).
    const fetch = mockFetchSequence([
      okBody("v1"),
      errorBody(500),
      errorBody(500),
      okBody("v1"),
      errorBody(500),
      errorBody(500),
      errorBody(500),
    ]);

    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    // Tick 1: fail
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    // Tick 2: fail
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(STALE_TEXT)).toBeNull();

    // Tick 3: success — resets counter.
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(screen.queryByText(STALE_TEXT)).toBeNull();

    // Now 2 more failures — should NOT trip yet (counter starts at 0 after success).
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(screen.queryByText(STALE_TEXT)).toBeNull();

    // Third NEW failure trips the chip.
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(screen.getByText(STALE_TEXT)).toBeInTheDocument();
  });

  it("aborts previous fetch when a new poll fires before the previous resolves", async () => {
    // Stub fetch with a never-resolving promise so we can inspect the
    // signal it received without it ever completing. The hook should
    // abort the first signal as soon as the next interval tick fires.
    const signals: AbortSignal[] = [];
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      // Never resolves — simulates a hung request.
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetch);

    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    // Trigger the next poll — the hung first fetch should be aborted.
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
  });

  it("logs console.error exactly once across a 3-failure streak", async () => {
    mockFetchSequence([errorBody(500), errorBody(500), errorBody(500)]);

    render(<RunwayBoard {...defaultProps} />);
    await act(async () => {
      await flushPromises();
    });
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });
    await act(async () => {
      vi.advanceTimersByTime(15 * 1000);
      await flushPromises();
    });

    expect(screen.getByText(STALE_TEXT)).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("mergeWeekendDays", () => {
  it("merges adjacent Sat+Sun into a single Weekend column", () => {
    const days: DayItem[] = [
      { date: "2026-04-10", label: "Fri 4/10", items: [{ title: "Fri thing", account: "A", type: "delivery" }] },
      { date: "2026-04-11", label: "Sat 4/11", items: [{ title: "Sat thing", account: "B", type: "review" }] },
      { date: "2026-04-12", label: "Sun 4/12", items: [{ title: "Sun thing", account: "C", type: "kickoff" }] },
      { date: "2026-04-13", label: "Mon 4/13", items: [{ title: "Mon thing", account: "D", type: "delivery" }] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe("Fri 4/10");
    expect(result[1].label).toBe("Weekend");
    expect(result[1].items).toHaveLength(2);
    expect(result[1].items[0].title).toBe("Sat thing");
    expect(result[1].items[1].title).toBe("Sun thing");
    expect(result[2].label).toBe("Mon 4/13");
  });

  it("passes through Saturday alone (no Sunday follows)", () => {
    const days: DayItem[] = [
      { date: "2026-04-11", label: "Sat 4/11", items: [{ title: "Sat only", account: "A", type: "delivery" }] },
      { date: "2026-04-13", label: "Mon 4/13", items: [{ title: "Mon thing", account: "B", type: "delivery" }] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Sat 4/11");
  });

  it("passes through Sunday alone", () => {
    const days: DayItem[] = [
      { date: "2026-04-12", label: "Sun 4/12", items: [{ title: "Sun only", account: "A", type: "delivery" }] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Sun 4/12");
  });

  it("returns empty array for empty input", () => {
    expect(mergeWeekendDays([])).toEqual([]);
  });

  it("passes through weekdays unchanged", () => {
    const days: DayItem[] = [
      { date: "2026-04-06", label: "Mon 4/6", items: [] },
      { date: "2026-04-07", label: "Tue 4/7", items: [] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(2);
  });

  it("uses Saturday date for merged Weekend column", () => {
    const days: DayItem[] = [
      { date: "2026-04-11", label: "Sat 4/11", items: [{ title: "A", account: "X", type: "delivery" }] },
      { date: "2026-04-12", label: "Sun 4/12", items: [{ title: "B", account: "Y", type: "review" }] },
    ];
    const result = mergeWeekendDays(days);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-11");
    expect(result[0].label).toBe("Weekend");
  });
});

describe("groupByWeek", () => {
  it("groups days from the same week together", () => {
    const days: DayItem[] = [
      { date: "2026-04-13", label: "Mon 4/13", items: [] },
      { date: "2026-04-14", label: "Tue 4/14", items: [] },
      { date: "2026-04-15", label: "Wed 4/15", items: [] },
    ];
    const result = groupByWeek(days);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("w/o 4/13");
    expect(result[0].days).toHaveLength(3);
  });

  it("creates separate groups for different weeks", () => {
    const days: DayItem[] = [
      { date: "2026-04-13", label: "Mon 4/13", items: [] },
      { date: "2026-04-20", label: "Mon 4/20", items: [] },
      { date: "2026-04-21", label: "Tue 4/21", items: [] },
    ];
    const result = groupByWeek(days);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("w/o 4/13");
    expect(result[0].days).toHaveLength(1);
    expect(result[1].label).toBe("w/o 4/20");
    expect(result[1].days).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(groupByWeek([])).toEqual([]);
  });

  it("stores mondayDate as ISO string", () => {
    const days: DayItem[] = [
      { date: "2026-04-15", label: "Wed 4/15", items: [] },
    ];
    const result = groupByWeek(days);
    expect(result[0].mondayDate).toBe("2026-04-13");
  });
});
