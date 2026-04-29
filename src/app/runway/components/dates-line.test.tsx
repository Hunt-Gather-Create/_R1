import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DatesLine } from "./dates-line";

describe("DatesLine", () => {
  it("renders both dates with en-dash separator and no padding", () => {
    render(<DatesLine startDate="2026-04-17" endDate="2026-05-11" />);
    const line = screen.getByTestId("dates-line");
    expect(line).toHaveTextContent("Dates: 4/17 – 5/11");
    expect(screen.queryByTestId("dates-null")).not.toBeInTheDocument();
  });

  it("collapses to a single date when start === end (milestone)", () => {
    render(<DatesLine startDate="2026-05-11" endDate="2026-05-11" />);
    const line = screen.getByTestId("dates-line");
    expect(line).toHaveTextContent("Dates: 5/11");
    expect(screen.queryByTestId("dates-null")).not.toBeInTheDocument();
  });

  it("renders both null words red when both dates are null", () => {
    render(<DatesLine startDate={null} endDate={null} />);
    const line = screen.getByTestId("dates-line");
    expect(line).toHaveTextContent("Dates: null – null");
    const nulls = screen.getAllByTestId("dates-null");
    expect(nulls).toHaveLength(2);
    nulls.forEach((n) => expect(n.className).toContain("text-red-400"));
  });

  it("renders only the first null red when start is null and end is present", () => {
    render(<DatesLine startDate={null} endDate="2026-05-11" />);
    const line = screen.getByTestId("dates-line");
    expect(line).toHaveTextContent("Dates: null – 5/11");
    const nulls = screen.getAllByTestId("dates-null");
    expect(nulls).toHaveLength(1);
    expect(nulls[0].className).toContain("text-red-400");
  });

  it("renders only the second null red when end is null and start is present", () => {
    render(<DatesLine startDate="2026-04-17" endDate={null} />);
    const line = screen.getByTestId("dates-line");
    expect(line).toHaveTextContent("Dates: 4/17 – null");
    const nulls = screen.getAllByTestId("dates-null");
    expect(nulls).toHaveLength(1);
    expect(nulls[0].className).toContain("text-red-400");
  });

  it("renders end-before-start with no red treatment (bad order is the signal)", () => {
    render(<DatesLine startDate="2026-05-11" endDate="2026-04-17" />);
    const line = screen.getByTestId("dates-line");
    expect(line).toHaveTextContent("Dates: 5/11 – 4/17");
    expect(screen.queryByTestId("dates-null")).not.toBeInTheDocument();
  });

  it("strips zero-padding from ISO month and day", () => {
    render(<DatesLine startDate="2026-04-07" endDate="2026-09-03" />);
    expect(screen.getByTestId("dates-line")).toHaveTextContent("Dates: 4/7 – 9/3");
  });

  it("treats undefined the same as null", () => {
    render(<DatesLine />);
    const line = screen.getByTestId("dates-line");
    expect(line).toHaveTextContent("Dates: null – null");
    expect(screen.getAllByTestId("dates-null")).toHaveLength(2);
  });

  it("applies a custom className when provided", () => {
    render(<DatesLine startDate="2026-04-17" endDate="2026-05-11" className="text-sm text-foreground" />);
    const line = screen.getByTestId("dates-line");
    expect(line.className).toContain("text-sm");
    expect(line.className).toContain("text-foreground");
  });
});
