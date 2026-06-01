/**
 * Tests for the resource chip editor (#70 commit 8a). Covers the
 * operator-polished UX: role dropdown + name input per chip, add
 * button, delete via × + Backspace-on-empty-name, free-text fallback
 * when the value can't be safely round-tripped (arrow sequences).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResourceChipEditor } from "./resource-chip-editor";

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

describe("ResourceChipEditor", () => {
  it("renders one chip per parsed entry with role + name pre-filled", () => {
    render(
      <ResourceChipEditor value="AM: Jill, CD: Mark" onChange={() => {}} />,
    );
    const chips = screen.getAllByTestId("resource-chip");
    expect(chips).toHaveLength(2);
    const roles = screen.getAllByTestId("resource-chip-role");
    const names = screen.getAllByTestId("resource-chip-name");
    expect((roles[0] as HTMLSelectElement).value).toBe("AM");
    expect((names[0] as HTMLInputElement).value).toBe("Jill");
    expect((roles[1] as HTMLSelectElement).value).toBe("CD");
    expect((names[1] as HTMLInputElement).value).toBe("Mark");
  });

  it("renders an empty editor with a single Add button when value is empty", () => {
    render(<ResourceChipEditor value="" onChange={() => {}} />);
    expect(screen.queryAllByTestId("resource-chip")).toHaveLength(0);
    expect(screen.getByTestId("resource-chip-add")).toBeInTheDocument();
  });

  it("calls onChange with the serialized 'Role: Name, Role: Name' string when a name field changes", () => {
    const handle = vi.fn();
    render(<ResourceChipEditor value="AM: Jill" onChange={handle} />);
    const name = screen.getAllByTestId("resource-chip-name")[0];
    fireEvent.change(name, { target: { value: "Jamie" } });
    expect(handle).toHaveBeenLastCalledWith("AM: Jamie");
  });

  it("calls onChange with the serialized string when a role dropdown changes", () => {
    const handle = vi.fn();
    render(<ResourceChipEditor value="AM: Jill" onChange={handle} />);
    const role = screen.getAllByTestId("resource-chip-role")[0];
    fireEvent.change(role, { target: { value: "CD" } });
    expect(handle).toHaveBeenLastCalledWith("CD: Jill");
  });

  it("appends a new empty chip on Add click and focuses its name input for keyboard polish", () => {
    const handle = vi.fn();
    render(<ResourceChipEditor value="AM: Jill" onChange={handle} />);
    fireEvent.click(screen.getByTestId("resource-chip-add"));
    const chips = screen.getAllByTestId("resource-chip");
    expect(chips).toHaveLength(2);
    const newName = screen.getAllByTestId("resource-chip-name")[1];
    expect(document.activeElement).toBe(newName);
  });

  it("removes a chip when the × delete button is clicked, serializing the survivors", () => {
    const handle = vi.fn();
    render(
      <ResourceChipEditor value="AM: Jill, CD: Mark" onChange={handle} />,
    );
    const removeButtons = screen.getAllByTestId("resource-chip-remove");
    fireEvent.click(removeButtons[0]);
    expect(screen.getAllByTestId("resource-chip")).toHaveLength(1);
    expect(handle).toHaveBeenLastCalledWith("CD: Mark");
  });

  it("Backspace on an empty name field removes the chip (keyboard parity with × button)", () => {
    const handle = vi.fn();
    render(
      <ResourceChipEditor value="AM: Jill, CD: " onChange={handle} />,
    );
    const names = screen.getAllByTestId("resource-chip-name");
    expect((names[1] as HTMLInputElement).value).toBe("");
    fireEvent.keyDown(names[1], { key: "Backspace" });
    expect(screen.getAllByTestId("resource-chip")).toHaveLength(1);
    expect(handle).toHaveBeenLastCalledWith("AM: Jill");
  });

  it("falls back to free-text textarea when the value contains arrow sequences (advanced form)", () => {
    render(
      <ResourceChipEditor value="CW: Kathy -> Dev: Lane" onChange={() => {}} />,
    );
    expect(screen.queryAllByTestId("resource-chip")).toHaveLength(0);
    expect(screen.getByTestId("resource-chip-fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("resource-chip-add")).toBeNull();
  });

  it("falls back to free-text textarea when the value lacks role prefixes (untagged)", () => {
    render(
      <ResourceChipEditor value="Jill, Mark" onChange={() => {}} />,
    );
    expect(screen.queryAllByTestId("resource-chip")).toHaveLength(0);
    expect(screen.getByTestId("resource-chip-fallback")).toBeInTheDocument();
  });

  it("free-text fallback forwards textarea edits through onChange unchanged", () => {
    const handle = vi.fn();
    render(
      <ResourceChipEditor value="CW: Kathy -> Dev: Lane" onChange={handle} />,
    );
    const ta = screen.getByTestId("resource-chip-fallback") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "PM: Sam" } });
    expect(handle).toHaveBeenLastCalledWith("PM: Sam");
  });

  it("renders all 7 canonical role options in each chip's dropdown", () => {
    render(<ResourceChipEditor value="AM: Jill" onChange={() => {}} />);
    const role = screen.getAllByTestId("resource-chip-role")[0];
    const options = Array.from(role.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toEqual(["AM", "CD", "Dev", "CW", "PM", "CM", "Strat"]);
  });
});
