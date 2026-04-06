import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, StaleBadge, ContractBadge, MetadataLabel, STATUS_STYLES, TYPE_INDICATORS } from "./status-badge";
import type { ItemStatus } from "../types";

describe("StatusBadge", () => {
  const statuses: ItemStatus[] = [
    "in-production",
    "awaiting-client",
    "not-started",
    "blocked",
    "on-hold",
    "completed",
  ];

  it.each(statuses)("renders label for status '%s'", (status) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(STATUS_STYLES[status].label)).toBeInTheDocument();
  });

  it("applies correct class for in-production", () => {
    const { container } = render(<StatusBadge status="in-production" />);
    const badge = container.querySelector("span")!;
    expect(badge.className).toContain("bg-emerald-500/20");
    expect(badge.className).toContain("text-emerald-400");
  });

  it("applies correct class for blocked", () => {
    const { container } = render(<StatusBadge status="blocked" />);
    const badge = container.querySelector("span")!;
    expect(badge.className).toContain("bg-red-500/20");
    expect(badge.className).toContain("text-red-400");
  });
});

describe("StaleBadge", () => {
  it("returns null for days < 7", () => {
    const { container } = render(<StaleBadge days={6} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders weeks count for 7+ days", () => {
    render(<StaleBadge days={14} />);
    expect(screen.getByText("2w waiting")).toBeInTheDocument();
  });

  it("uses amber color for < 30 days", () => {
    const { container } = render(<StaleBadge days={14} />);
    const badge = container.querySelector("span")!;
    expect(badge.className).toContain("bg-amber-500/20");
  });

  it("uses red color for >= 30 days", () => {
    const { container } = render(<StaleBadge days={35} />);
    const badge = container.querySelector("span")!;
    expect(badge.className).toContain("bg-red-500/20");
  });

  it("rounds down weeks (21 days = 3w)", () => {
    render(<StaleBadge days={21} />);
    expect(screen.getByText("3w waiting")).toBeInTheDocument();
  });

  it("shows exactly at boundary (7 days = 1w)", () => {
    render(<StaleBadge days={7} />);
    expect(screen.getByText("1w waiting")).toBeInTheDocument();
  });
});

describe("ContractBadge", () => {
  it("renders SOW Expired for expired status", () => {
    render(<ContractBadge status="expired" />);
    expect(screen.getByText("SOW Expired")).toBeInTheDocument();
  });

  it("applies red styling for expired", () => {
    const { container } = render(<ContractBadge status="expired" />);
    const badge = container.querySelector("span")!;
    expect(badge.className).toContain("bg-red-500/20");
    expect(badge.className).toContain("text-red-400");
  });

  it("renders SOW Unsigned for unsigned status", () => {
    render(<ContractBadge status="unsigned" />);
    expect(screen.getByText("SOW Unsigned")).toBeInTheDocument();
  });

  it("applies violet styling for unsigned", () => {
    const { container } = render(<ContractBadge status="unsigned" />);
    const badge = container.querySelector("span")!;
    expect(badge.className).toContain("bg-violet-500/20");
    expect(badge.className).toContain("text-violet-400");
  });

  it("renders nothing for signed status", () => {
    const { container } = render(<ContractBadge status="signed" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("MetadataLabel", () => {
  it("renders label and value", () => {
    render(<MetadataLabel label="Owner" value="Kathy" />);
    expect(screen.getByText("Owner: Kathy")).toBeInTheDocument();
  });

  it("applies default muted-foreground styling", () => {
    const { container } = render(<MetadataLabel label="Owner" value="Kathy" />);
    const span = container.querySelector("span")!;
    expect(span.className).toContain("text-muted-foreground");
  });

  it("applies custom className when provided", () => {
    const { container } = render(
      <MetadataLabel label="Waiting on" value="Daniel" className="text-xs text-amber-400/80" />
    );
    const span = container.querySelector("span")!;
    expect(span.className).toContain("text-amber-400/80");
    expect(span.className).not.toContain("text-muted-foreground");
  });
});

describe("TYPE_INDICATORS", () => {
  it("has entries for all expected categories", () => {
    const expected = ["delivery", "review", "kickoff", "deadline", "approval", "launch", "blocked"];
    for (const key of expected) {
      expect(TYPE_INDICATORS[key]).toBeDefined();
    }
  });

  it("all values are Tailwind text color classes", () => {
    for (const value of Object.values(TYPE_INDICATORS)) {
      expect(value).toMatch(/^text-\w+-\d+$/);
    }
  });
});
