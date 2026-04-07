import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NeedsUpdateSection } from "./needs-update-section";
import type { DayItem } from "../types";

const staleDay: DayItem = {
  date: "2026-04-06",
  label: "Mon 4/6",
  items: [
    { title: "CDS Review", account: "Convergix", type: "review", owner: "Kathy" },
    { title: "Website Check", account: "Convergix", type: "delivery" },
  ],
};

const staleDay2: DayItem = {
  date: "2026-04-05",
  label: "Sun 4/5",
  items: [
    { title: "LPPC Kickoff", account: "LPPC", type: "kickoff" },
  ],
};

describe("NeedsUpdateSection", () => {
  it("renders nothing when staleItems is empty", () => {
    const { container } = render(<NeedsUpdateSection staleItems={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when all days have no items", () => {
    const emptyDays: DayItem[] = [{ date: "2026-04-06", label: "Mon 4/6", items: [] }];
    const { container } = render(<NeedsUpdateSection staleItems={emptyDays} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the heading with red styling", () => {
    render(<NeedsUpdateSection staleItems={[staleDay]} />);
    expect(screen.getByText("Needs Update")).toBeInTheDocument();
  });

  it("shows total count badge", () => {
    render(<NeedsUpdateSection staleItems={[staleDay, staleDay2]} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows the helper text", () => {
    render(<NeedsUpdateSection staleItems={[staleDay]} />);
    expect(screen.getByText(/DM the bot to clear them/)).toBeInTheDocument();
  });

  it("renders day labels", () => {
    render(<NeedsUpdateSection staleItems={[staleDay]} />);
    expect(screen.getByText("Mon 4/6")).toBeInTheDocument();
  });

  it("renders item titles", () => {
    render(<NeedsUpdateSection staleItems={[staleDay]} />);
    expect(screen.getByText("CDS Review")).toBeInTheDocument();
    expect(screen.getByText("Website Check")).toBeInTheDocument();
  });

  it("renders items from multiple days", () => {
    render(<NeedsUpdateSection staleItems={[staleDay2, staleDay]} />);
    expect(screen.getByText("LPPC Kickoff")).toBeInTheDocument();
    expect(screen.getByText("CDS Review")).toBeInTheDocument();
  });
});
