import { describe, it, expect, vi } from "vitest";
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

describe("NeedsUpdateSection (toggle mode)", () => {
  it("renders inline toggle in header when onToggle provided", () => {
    const onToggle = vi.fn().mockResolvedValue({});
    render(
      <NeedsUpdateSection staleItems={[staleDay]} enabled onToggle={onToggle} />
    );
    expect(screen.getByTestId("needs-update-toggle")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs Update" })).toBeInTheDocument();
  });

  it("keeps the heading + toggle visible when toggled off so user can re-enable", () => {
    const onToggle = vi.fn().mockResolvedValue({});
    render(
      <NeedsUpdateSection staleItems={[staleDay]} enabled={false} onToggle={onToggle} />
    );
    expect(screen.getByTestId("needs-update-section")).toBeInTheDocument();
    expect(screen.getByTestId("needs-update-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("needs-update-count")).not.toBeInTheDocument();
    expect(screen.queryByText(/DM the bot to clear them/)).not.toBeInTheDocument();
    expect(screen.queryByText("CDS Review")).not.toBeInTheDocument();
  });

  it("hides count when toggled off but keeps the heading", () => {
    const onToggle = vi.fn().mockResolvedValue({});
    render(
      <NeedsUpdateSection staleItems={[staleDay]} enabled={false} onToggle={onToggle} />
    );
    expect(screen.getByRole("heading", { name: "Needs Update" })).toBeInTheDocument();
  });

  it("renders the heading row even when there are zero stale items so user can leave it on", () => {
    const onToggle = vi.fn().mockResolvedValue({});
    render(
      <NeedsUpdateSection staleItems={[]} enabled onToggle={onToggle} />
    );
    expect(screen.getByTestId("needs-update-section")).toBeInTheDocument();
    expect(screen.getByTestId("needs-update-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("needs-update-count")).not.toBeInTheDocument();
  });

  it("legacy mode (no toggle props) hides entirely when zero items", () => {
    const { container } = render(<NeedsUpdateSection staleItems={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
