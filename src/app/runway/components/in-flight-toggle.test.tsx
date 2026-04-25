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
      screen.getByText("Showing in-flight L2s above Today.")
    ).toBeInTheDocument();
  });

  it("shows the hidden description when off", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<InFlightToggle initialEnabled={false} onToggle={onToggle} />);
    expect(screen.getByText("In Flight hidden.")).toBeInTheDocument();
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
