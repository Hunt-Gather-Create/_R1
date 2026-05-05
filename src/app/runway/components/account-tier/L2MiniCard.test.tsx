import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { L2MiniCard } from "./L2MiniCard";

const baseItem = {
  id: "wi-1",
  title: "Kickoff deck draft",
  owner: "Lane",
  resources: "CD: Lane, Dev: Leslie",
  startDate: "2026-05-04",
  endDate: "2026-05-08",
  status: "in-progress",
  category: "delivery",
};

describe("L2MiniCard", () => {
  it("renders title, owner, resources, and date range in light theme", () => {
    render(<L2MiniCard weekItem={baseItem} />);
    expect(screen.getByText("Kickoff deck draft")).toBeTruthy();
    expect(screen.getByTestId("owner-line").textContent).toContain("Lane");
    expect(screen.getByTestId("resources-line").textContent).toBe(
      "CD: Lane, Dev: Leslie",
    );
    // 2026-05-04 -> 5/4, 2026-05-08 -> 5/8
    expect(screen.getByText(/5\/4\s*[–-]\s*5\/8/)).toBeTruthy();
  });

  it("applies blue status color bar for in-progress (light)", () => {
    const { container } = render(
      <L2MiniCard
        weekItem={{ ...baseItem, status: "in-progress" }}
        theme="light"
      />,
    );
    const bar = container.querySelector('[data-testid="status-bar"]');
    expect(bar).not.toBeNull();
    expect(bar!.className).toContain("bg-blue-500");
  });

  it("applies amber status color bar for at-risk (light)", () => {
    const { container } = render(
      <L2MiniCard
        weekItem={{ ...baseItem, status: "at-risk" }}
        theme="light"
      />,
    );
    const bar = container.querySelector('[data-testid="status-bar"]');
    expect(bar!.className).toContain("bg-amber-400");
  });

  it("renders completed card with opacity-50 outer + line-through title", () => {
    const { container } = render(
      <L2MiniCard weekItem={{ ...baseItem, status: "completed" }} />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("opacity-50");
    const title = screen.getByText("Kickoff deck draft");
    expect(title.className).toContain("line-through");
  });

  it("renders canceled card with line-through title", () => {
    render(<L2MiniCard weekItem={{ ...baseItem, status: "canceled" }} />);
    const title = screen.getByText("Kickoff deck draft");
    expect(title.className).toContain("line-through");
  });

  it("renders single date as M/D when startDate === endDate", () => {
    render(
      <L2MiniCard
        weekItem={{
          ...baseItem,
          startDate: "2026-05-04",
          endDate: "2026-05-04",
        }}
      />,
    );
    // Should render exactly "5/4", not "5/4 – 5/4"
    expect(screen.getByText("5/4")).toBeTruthy();
  });

  it("hides resources line when resources is null", () => {
    render(
      <L2MiniCard
        weekItem={{ ...baseItem, resources: null }}
      />,
    );
    expect(screen.queryByText(/CD:/)).toBeNull();
  });

  it("hides category chip when category is null", () => {
    const { container } = render(
      <L2MiniCard weekItem={{ ...baseItem, category: null }} />,
    );
    expect(container.querySelector('[data-testid="category-chip"]')).toBeNull();
  });

  it("renders warning and critical badges when counts > 0", () => {
    render(
      <L2MiniCard weekItem={baseItem} warningCount={2} criticalCount={1} />,
    );
    expect(screen.getByText(/2 warn/)).toBeTruthy();
    expect(screen.getByText(/1 critical/)).toBeTruthy();
  });

  it("hides date line when both startDate and endDate are null", () => {
    const { container } = render(
      <L2MiniCard
        weekItem={{ ...baseItem, startDate: null, endDate: null }}
      />,
    );
    expect(container.querySelector('[data-testid="date-line"]')).toBeNull();
  });

  it("hides owner line when owner is null", () => {
    render(<L2MiniCard weekItem={{ ...baseItem, owner: null }} />);
    expect(screen.queryByText(/^O:/)).toBeNull();
  });
});
