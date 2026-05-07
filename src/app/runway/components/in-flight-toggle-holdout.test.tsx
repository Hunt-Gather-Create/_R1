/**
 * Holdout QA tests for In Flight toggle (dashboard-cleanup item 3).
 * Focus: double-trigger race, error boundary, state transition edge cases.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { InFlightToggle } from "./in-flight-toggle";

describe("InFlightToggle holdout: rapid double-click race", () => {
  it("does not call onToggle twice on rapid double-click (isPending disables button)", async () => {
    let resolveFirst: () => void;
    const firstCallPromise = new Promise<void>((res) => { resolveFirst = res; });
    const onToggle = vi.fn().mockReturnValueOnce(firstCallPromise).mockResolvedValue(undefined);

    render(<InFlightToggle initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByTestId("in-flight-toggle");

    // First click starts the async transition
    fireEvent.click(toggle);
    // Second click while first is pending -- button should be disabled
    fireEvent.click(toggle);

    // onToggle should have been called only once (button was disabled on second click)
    expect(onToggle).toHaveBeenCalledTimes(1);

    await act(async () => { resolveFirst!(); });
  });
});

describe("InFlightToggle holdout: compact mode aria coverage", () => {
  it("compact mode still has aria-labelledby and aria-describedby in DOM", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(
      <InFlightToggle initialEnabled={true} onToggle={onToggle} compact />
    );
    const toggle = screen.getByTestId("in-flight-toggle");
    expect(toggle).toHaveAttribute("aria-labelledby", "in-flight-label");
    expect(toggle).toHaveAttribute("aria-describedby", "in-flight-desc");
    // sr-only elements still in DOM for assistive tech
    expect(document.getElementById("in-flight-label")).not.toBeNull();
    expect(document.getElementById("in-flight-desc")).not.toBeNull();
  });

  it("compact mode aria targets have correct text content", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(
      <InFlightToggle initialEnabled={false} onToggle={onToggle} compact />
    );
    const label = document.getElementById("in-flight-label");
    const desc = document.getElementById("in-flight-desc");
    expect(label?.textContent).toBe("In Flight");
    expect(desc?.textContent).toBe("Toggle on to view tasks that are in flight for projects.");
  });
});
