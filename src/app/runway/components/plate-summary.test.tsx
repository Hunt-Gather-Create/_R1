import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlateSummary } from "./plate-summary";
import type { Account, TriageItem } from "../types";

function makeTriage(overrides: Partial<TriageItem> = {}): TriageItem {
  return {
    id: "p1",
    title: "Test Project",
    status: "in-production",
    category: "active",
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: "Convergix",
    slug: "convergix",
    contractStatus: "signed",
    items: [],
    ...overrides,
  };
}

describe("PlateSummary", () => {
  it("returns null when no soft flags apply", () => {
    const { container } = render(
      <PlateSummary accounts={[makeAccount()]} nowISO="2026-04-20" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a retainer renewal pill within the 30-day window", () => {
    const accounts = [
      makeAccount({
        name: "Soundly",
        contractStatus: "signed",
        items: [
          makeTriage({
            title: "Payment Gateway",
            engagementType: "retainer",
            contractEnd: "2026-05-05", // 15 days out
          }),
        ],
      }),
    ];

    render(<PlateSummary accounts={accounts} nowISO="2026-04-20" />);
    const pill = screen.getByTestId("retainer-renewal-pill");
    expect(pill).toHaveTextContent("Renewal: Payment Gateway expires 2026-05-05");
  });

  it("renders a contract-expired pill for expired client with active work", () => {
    const accounts = [
      makeAccount({
        name: "High Desert Law",
        contractStatus: "expired",
        items: [makeTriage({ status: "in-production" })],
      }),
    ];

    render(<PlateSummary accounts={accounts} nowISO="2026-04-20" />);
    const pill = screen.getByTestId("contract-expired-pill");
    expect(pill).toHaveTextContent("Contract expired: High Desert Law");
  });

  it("renders both pill types when both apply", () => {
    const accounts = [
      makeAccount({
        name: "Soundly",
        contractStatus: "signed",
        items: [
          makeTriage({
            title: "Payment Gateway",
            engagementType: "retainer",
            contractEnd: "2026-05-05",
          }),
        ],
      }),
      makeAccount({
        name: "High Desert Law",
        contractStatus: "expired",
        items: [makeTriage({ status: "in-production" })],
      }),
    ];

    render(<PlateSummary accounts={accounts} nowISO="2026-04-20" />);
    expect(screen.getByTestId("retainer-renewal-pill")).toBeInTheDocument();
    expect(screen.getByTestId("contract-expired-pill")).toBeInTheDocument();
  });

  it("does not render a renewal pill outside the 30-day window", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({
            engagementType: "retainer",
            contractEnd: "2026-07-01", // >30 days out
          }),
        ],
      }),
    ];

    render(<PlateSummary accounts={accounts} nowISO="2026-04-20" />);
    expect(screen.queryByTestId("retainer-renewal-pill")).not.toBeInTheDocument();
  });
});
