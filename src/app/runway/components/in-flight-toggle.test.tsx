import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { InFlightToggle } from "./in-flight-toggle";

describe("InFlightToggle", () => {
  it("renders with the In Flight label", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={true} onToggle={onToggle} />);
    expect(screen.getByText("In Flight")).toBeInTheDocument();
  });

  it("renders a switch role with aria-checked reflecting initial state (on)", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("renders with aria-checked=false when initialEnabled is false", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("flips aria-checked on click", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("calls onToggle with the new state when clicked", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("calls onToggle with true when toggling from off to on", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("invokes the onChange callback in sync with the toggle", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(
      <InFlightToggle
        initialEnabled={true}
        onToggle={onToggle}
        onChange={onChange}
      />
    );
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("shows the enabled description when on", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={true} onToggle={onToggle} />);
    expect(
      screen.getByText("Showing tasks that are already in flight for projects.")
    ).toBeInTheDocument();
  });

  it("shows the hidden description when off", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={false} onToggle={onToggle} />);
    expect(screen.getByText("Toggle on to view tasks that are in flight for projects.")).toBeInTheDocument();
  });

  it("uses aria-labelledby pointing at the visible 'In Flight' label", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    expect(toggle).toHaveAttribute("aria-labelledby", "in-flight-label");
    const label = document.getElementById("in-flight-label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("In Flight");
  });

  it("uses aria-describedby pointing at the ON description sentence when enabled", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    expect(toggle).toHaveAttribute("aria-describedby", "in-flight-desc");
    const desc = document.getElementById("in-flight-desc");
    expect(desc).not.toBeNull();
    expect(desc?.textContent).toBe(
      "Showing tasks that are already in flight for projects."
    );
  });

  it("uses aria-describedby pointing at the OFF description sentence when disabled", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    expect(toggle).toHaveAttribute("aria-describedby", "in-flight-desc");
    const desc = document.getElementById("in-flight-desc");
    expect(desc).not.toBeNull();
    expect(desc?.textContent).toBe(
      "Toggle on to view tasks that are in flight for projects."
    );
  });

  it("updates the description text inside #in-flight-desc when the switch is toggled", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "In Flight" });
    expect(document.getElementById("in-flight-desc")?.textContent).toBe(
      "Toggle on to view tasks that are in flight for projects."
    );
    fireEvent.click(toggle);
    expect(document.getElementById("in-flight-desc")?.textContent).toBe(
      "Showing tasks that are already in flight for projects."
    );
  });

  // 4c: when the persistence call rejects, the optimistic flip must be
  // reverted so the UI matches the server's actual state.
  it("reverts optimistic state and logs an error when onToggle rejects", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("server down"));
    const onChange = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <InFlightToggle
        initialEnabled={true}
        onToggle={onToggle}
        onChange={onChange}
      />
    );
    const toggle = screen.getByRole("switch", { name: "In Flight" });

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(onChange).toHaveBeenNthCalledWith(1, false);
    expect(onChange).toHaveBeenNthCalledWith(2, true);
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls[0][0] as string;
    expect(logged).toContain("in_flight_toggle_error");
    expect(logged).toContain("server down");

    errorSpy.mockRestore();
  });
});
