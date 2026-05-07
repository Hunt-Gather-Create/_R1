import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NeedsUpdateToggle } from "./needs-update-toggle";

describe("NeedsUpdateToggle", () => {
  it("renders with the Needs Update label", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<NeedsUpdateToggle initialEnabled={true} onToggle={onToggle} />);
    expect(screen.getByText("Needs Update")).toBeInTheDocument();
  });

  it("renders a switch role with aria-checked reflecting initial state (on)", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<NeedsUpdateToggle initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "Needs Update" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("renders with aria-checked=false when initialEnabled is false", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<NeedsUpdateToggle initialEnabled={false} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "Needs Update" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("flips aria-checked on click", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<NeedsUpdateToggle initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "Needs Update" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("calls onToggle with the new state when clicked", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<NeedsUpdateToggle initialEnabled={true} onToggle={onToggle} />);
    const toggle = screen.getByRole("switch", { name: "Needs Update" });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("invokes onChange in sync with the toggle", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const onChange = vi.fn();
    render(
      <NeedsUpdateToggle
        initialEnabled={true}
        onToggle={onToggle}
        onChange={onChange}
      />
    );
    const toggle = screen.getByRole("switch", { name: "Needs Update" });
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("reverts optimistic state and logs an error when onToggle rejects", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("server down"));
    const onChange = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <NeedsUpdateToggle
        initialEnabled={true}
        onToggle={onToggle}
        onChange={onChange}
      />
    );
    const toggle = screen.getByRole("switch", { name: "Needs Update" });

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(onChange).toHaveBeenNthCalledWith(1, false);
    expect(onChange).toHaveBeenNthCalledWith(2, true);
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls[0][0] as string;
    expect(logged).toContain("needs_update_toggle_error");
    expect(logged).toContain("server down");

    errorSpy.mockRestore();
  });

  it("compact mode keeps aria targets but hides visible label", () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(
      <NeedsUpdateToggle initialEnabled={true} onToggle={onToggle} compact />
    );
    const label = document.getElementById("needs-update-label");
    expect(label).not.toBeNull();
    expect(label?.className).toContain("sr-only");
  });
});
