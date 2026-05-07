import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SectionToggle, type SectionToggleKey } from "./section-toggle";

interface Fixture {
  section: SectionToggleKey;
  label: string;
  descOn: string;
  descOff: string;
  errorEvent: string;
  testid: string;
  labelId: string;
  descId: string;
}

const FIXTURES: Fixture[] = [
  {
    section: "in-flight",
    label: "In Flight",
    descOn: "Showing tasks that are already in flight for projects.",
    descOff: "Toggle on to view tasks that are in flight for projects.",
    errorEvent: "in_flight_toggle_error",
    testid: "in-flight-toggle",
    labelId: "in-flight-label",
    descId: "in-flight-desc",
  },
  {
    section: "needs-update",
    label: "Needs Update",
    descOn: "Showing items that need an update.",
    descOff: "Toggle on to view items that need an update.",
    errorEvent: "needs_update_toggle_error",
    testid: "needs-update-toggle",
    labelId: "needs-update-label",
    descId: "needs-update-desc",
  },
];

describe.each(FIXTURES)("SectionToggle ($section)", (fx) => {
  it("renders with the section label", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={true} onToggle={onToggle} />);
    expect(screen.getByText(fx.label)).toBeInTheDocument();
  });

  it("renders aria-checked=true when initialEnabled is true", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: fx.label });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("renders aria-checked=false when initialEnabled is false", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: fx.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("flips aria-checked on click", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: fx.label });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("calls onToggle with the new state when clicked", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: fx.label });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("calls onToggle with true when toggling from off to on", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: fx.label });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("invokes onChange in sync with the toggle", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(
      <SectionToggle
        section={fx.section}
        initialEnabled={true}
        onToggle={onToggle}
        onChange={onChange}
      />
    );
    const toggle = screen.getByRole("switch", { name: fx.label });
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("shows the enabled description when on", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={true} onToggle={onToggle} />);
    expect(screen.getByText(fx.descOn)).toBeInTheDocument();
  });

  it("shows the disabled description when off", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={false} onToggle={onToggle} />);
    expect(screen.getByText(fx.descOff)).toBeInTheDocument();
  });

  it("uses aria-labelledby pointing at the visible label element", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: fx.label });
    expect(toggle).toHaveAttribute("aria-labelledby", fx.labelId);
    const label = document.getElementById(fx.labelId);
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe(fx.label);
  });

  it("uses aria-describedby pointing at the ON description sentence when enabled", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: fx.label });
    expect(toggle).toHaveAttribute("aria-describedby", fx.descId);
    const desc = document.getElementById(fx.descId);
    expect(desc?.textContent).toBe(fx.descOn);
  });

  it("uses aria-describedby pointing at the OFF description sentence when disabled", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: fx.label });
    expect(toggle).toHaveAttribute("aria-describedby", fx.descId);
    const desc = document.getElementById(fx.descId);
    expect(desc?.textContent).toBe(fx.descOff);
  });

  it("updates the description text inside the desc node when the switch is toggled", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: fx.label });
    expect(document.getElementById(fx.descId)?.textContent).toBe(fx.descOff);
    fireEvent.click(toggle);
    expect(document.getElementById(fx.descId)?.textContent).toBe(fx.descOn);
  });

  it("reverts optimistic state and logs the section-specific error event when onToggle rejects", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("server down"));
    const onChange = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <SectionToggle
        section={fx.section}
        initialEnabled={true}
        onToggle={onToggle}
        onChange={onChange}
      />
    );
    const toggle = screen.getByRole("switch", { name: fx.label });

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(onChange).toHaveBeenNthCalledWith(1, false);
    expect(onChange).toHaveBeenNthCalledWith(2, true);
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls[0][0] as string;
    expect(logged).toContain(fx.errorEvent);
    expect(logged).toContain("server down");

    errorSpy.mockRestore();
  });

  it("compact mode keeps aria targets in DOM but hides them visually (sr-only)", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={true} onToggle={onToggle} compact />);
    const toggle = screen.getByTestId(fx.testid);
    expect(toggle).toHaveAttribute("aria-labelledby", fx.labelId);
    expect(toggle).toHaveAttribute("aria-describedby", fx.descId);
    const label = document.getElementById(fx.labelId);
    const desc = document.getElementById(fx.descId);
    expect(label?.className).toContain("sr-only");
    expect(desc?.className).toContain("sr-only");
    expect(label?.textContent).toBe(fx.label);
  });

  it("compact mode renders correct OFF description text", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<SectionToggle section={fx.section} initialEnabled={false} onToggle={onToggle} compact />);
    const desc = document.getElementById(fx.descId);
    expect(desc?.textContent).toBe(fx.descOff);
  });
});

describe("SectionToggle holdout: rapid double-click race", () => {
  it("does not call onToggle twice on rapid double-click (isPending disables button)", async () => {
    let resolveFirst: () => void;
    const firstCallPromise = new Promise<void>((res) => {
      resolveFirst = res;
    });
    const onToggle = vi
      .fn()
      .mockReturnValueOnce(firstCallPromise)
      .mockResolvedValue(undefined);

    render(<SectionToggle section="in-flight" initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByTestId("in-flight-toggle");

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(onToggle).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst!();
    });
  });
});
