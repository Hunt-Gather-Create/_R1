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
  it("renders title, owner, resources, and date range", () => {
    render(<L2MiniCard weekItem={baseItem} />);
    expect(screen.getByText("Kickoff deck draft")).toBeTruthy();
    // Owner uses "Owner: " prefix (mirrors By Week card vocabulary).
    expect(screen.getByText(/Owner:\s*Lane/)).toBeTruthy();
    // Resources uses "Resources: " prefix via MetadataLabel.
    expect(screen.getByText(/Resources:\s*CD:\s*Lane,\s*Dev:\s*Leslie/)).toBeTruthy();
    // 2026-05-04 -> 5/4, 2026-05-08 -> 5/8 — DatesLine renders "Dates: M/D – M/D"
    expect(screen.getByText(/Dates:\s*5\/4\s*[–-]\s*5\/8/)).toBeTruthy();
  });

  it("renders the account name when accountName prop is supplied", () => {
    render(<L2MiniCard weekItem={baseItem} accountName="Acme Corp" />);
    expect(screen.getByText("Acme Corp")).toBeTruthy();
  });

  it("hides the account name when accountName prop is omitted", () => {
    const { container } = render(<L2MiniCard weekItem={baseItem} />);
    // The account span uses ACCOUNT_CLASS — a small uppercase muted-foreground.
    // Without an accountName prop, no element with that class renders.
    expect(container.textContent).not.toContain("ACME");
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
    // DatesLine renders "Dates: 5/4" (single-day case)
    expect(screen.getByText(/Dates:\s*5\/4$/)).toBeTruthy();
  });

  it("hides resources line when resources is null", () => {
    render(
      <L2MiniCard
        weekItem={{ ...baseItem, resources: null }}
      />,
    );
    expect(screen.queryByText(/Resources:/)).toBeNull();
  });

  it("hides category chip when category is null", () => {
    const { container } = render(
      <L2MiniCard weekItem={{ ...baseItem, category: null }} />,
    );
    expect(container.querySelector('[data-testid="category-chip"]')).toBeNull();
  });

  it("renders the category chip with TYPE_INDICATORS color when category is set", () => {
    const { container } = render(
      <L2MiniCard weekItem={{ ...baseItem, category: "delivery" }} />,
    );
    const chip = container.querySelector('[data-testid="category-chip"]');
    expect(chip).not.toBeNull();
    // TYPE_INDICATORS["delivery"] === "text-emerald-400"
    expect(chip!.className).toContain("emerald");
  });

  it("renders warning and critical badges when counts > 0", () => {
    render(
      <L2MiniCard weekItem={baseItem} warningCount={2} criticalCount={1} />,
    );
    expect(screen.getByText(/2 warn/)).toBeTruthy();
    expect(screen.getByText(/1 critical/)).toBeTruthy();
  });

  it("hides date line entirely when both startDate and endDate are null", () => {
    const { container } = render(
      <L2MiniCard
        weekItem={{ ...baseItem, startDate: null, endDate: null }}
      />,
    );
    // No DatesLine should render (no "Dates:" text anywhere).
    expect(container.querySelector('[data-testid="dates-line"]')).toBeNull();
    expect(container.textContent).not.toContain("Dates:");
  });

  it("hides owner line when owner is null", () => {
    render(<L2MiniCard weekItem={{ ...baseItem, owner: null }} />);
    expect(screen.queryByText(/Owner:/)).toBeNull();
  });

  it("uses the design-token foreground class for the title (no explicit slate)", () => {
    render(<L2MiniCard weekItem={baseItem} />);
    const title = screen.getByText("Kickoff deck draft");
    expect(title.className).toContain("text-foreground");
    expect(title.className).not.toContain("slate-100");
    expect(title.className).not.toContain("slate-900");
  });

  it("uses the rounded-xl + sky border chrome (mirrors By Week card)", () => {
    const { container } = render(<L2MiniCard weekItem={baseItem} />);
    const card = container.querySelector('[data-testid="l2-mini-card"]');
    expect(card).not.toBeNull();
    expect(card!.className).toContain("rounded-xl");
    expect(card!.className).toContain("border-sky-500/30");
    expect(card!.className).toContain("bg-sky-500/5");
  });
});
