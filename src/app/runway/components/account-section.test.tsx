import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountSection } from "./account-section";
import type { Account } from "../types";

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: "Convergix",
    slug: "convergix",
    contractValue: "$100K",
    contractTerm: "Feb – Jul 2026",
    contractStatus: "signed",
    team: "CD: Lane / Copy: Kathy",
    items: [],
    ...overrides,
  };
}

describe("AccountSection", () => {
  it("renders account name and contract info", () => {
    render(<AccountSection account={createAccount()} />);
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("$100K")).toBeInTheDocument();
    expect(screen.getByText("Feb – Jul 2026")).toBeInTheDocument();
  });

  it("renders team info", () => {
    render(<AccountSection account={createAccount()} />);
    expect(screen.getByText("CD: Lane / Copy: Kathy")).toBeInTheDocument();
  });

  it("does not render team when absent", () => {
    render(<AccountSection account={createAccount({ team: undefined })} />);
    expect(screen.queryByText(/CD:/)).not.toBeInTheDocument();
  });

  it("renders SOW Expired badge for expired contracts", () => {
    render(
      <AccountSection
        account={createAccount({ contractStatus: "expired" })}
      />
    );
    expect(screen.getByText("SOW Expired")).toBeInTheDocument();
  });

  it("renders SOW Unsigned badge for unsigned contracts", () => {
    render(
      <AccountSection
        account={createAccount({ contractStatus: "unsigned" })}
      />
    );
    expect(screen.getByText("SOW Unsigned")).toBeInTheDocument();
  });

  it("does not render contract badge for signed contracts", () => {
    render(
      <AccountSection
        account={createAccount({ contractStatus: "signed" })}
      />
    );
    expect(screen.queryByText("SOW Expired")).not.toBeInTheDocument();
    expect(screen.queryByText("SOW Unsigned")).not.toBeInTheDocument();
  });

  it("separates active and on-hold items", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "p1",
              title: "Active Project",
              status: "in-production",
              category: "active",
            },
            {
              id: "p2",
              title: "Hold Project",
              status: "on-hold",
              category: "on-hold",
              notes: "Deferred to Q3",
            },
          ],
        })}
      />
    );
    expect(screen.getByText("Active Project")).toBeInTheDocument();
    expect(screen.getByText("Hold Project")).toBeInTheDocument();
    expect(screen.getByText("On Hold")).toBeInTheDocument();
  });

  it("renders awaiting-client items in the active section", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "p1",
              title: "Waiting Item",
              status: "awaiting-client",
              category: "awaiting-client",
              waitingOn: "Daniel",
              staleDays: 14,
            },
          ],
        })}
      />
    );
    expect(screen.getByText("Waiting Item")).toBeInTheDocument();
    expect(screen.getByText("Waiting on: Daniel")).toBeInTheDocument();
    expect(screen.getByText("2w waiting")).toBeInTheDocument();
  });

  it("renders owner, target, and notes for items", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "p1",
              title: "Full Item",
              status: "in-production",
              category: "active",
              owner: "Kathy",
              target: "4/11",
              notes: "Gate for content",
            },
          ],
        })}
      />
    );
    expect(screen.getByText("Owner: Kathy")).toBeInTheDocument();
    expect(screen.getByText("Target: 4/11")).toBeInTheDocument();
    expect(screen.getByText("Gate for content")).toBeInTheDocument();
  });

  it("does not render database IDs in active items", () => {
    const { container } = render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "969fcb4e145e4cb4b3e118c59",
              title: "Test Project",
              status: "in-production",
              category: "active",
            },
          ],
        })}
      />
    );
    expect(container.textContent).not.toContain("969fcb4e145e4cb4b3e118c59");
  });

  it("does not render database IDs in on-hold items", () => {
    const { container } = render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "abc123def456ghi789jkl0000",
              title: "Hold Project",
              status: "on-hold",
              category: "on-hold",
            },
          ],
        })}
      />
    );
    expect(container.textContent).not.toContain("abc123def456ghi789jkl0000");
  });

  it("renders empty state when no items", () => {
    const { container } = render(
      <AccountSection account={createAccount({ items: [] })} />
    );
    // Should still render the account header
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    // On Hold section should not appear
    expect(container.textContent).not.toContain("On Hold");
  });
});
