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
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(container.textContent).not.toContain("On Hold");
  });

  it("sorts active items by target date", () => {
    const { container } = render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "Later", status: "in-production", category: "active", target: "5/1" },
            { id: "p2", title: "Earlier", status: "in-production", category: "active", target: "4/8" },
            { id: "p3", title: "No Date", status: "in-production", category: "active" },
          ],
        })}
      />
    );
    const text = container.textContent!;
    const earlierIdx = text.indexOf("Earlier");
    const laterIdx = text.indexOf("Later");
    const noDateIdx = text.indexOf("No Date");
    expect(earlierIdx).toBeLessThan(laterIdx);
    expect(laterIdx).toBeLessThan(noDateIdx);
  });

  it("shows short date on cards with target dates", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "Dated Item", status: "in-production", category: "active", target: "R1 to Daniel 4/7" },
          ],
        })}
      />
    );
    expect(screen.getByText("4/7")).toBeInTheDocument();
  });

  it("expands MSA abbreviation in contract terms", () => {
    render(
      <AccountSection
        account={createAccount({ contractTerm: "RLF MSA" })}
      />
    );
    expect(screen.getByText("RLF Master Service Agreement")).toBeInTheDocument();
  });

  it("does not render contract value when absent", () => {
    render(
      <AccountSection
        account={createAccount({ contractValue: undefined })}
      />
    );
    expect(screen.queryByText("$100K")).not.toBeInTheDocument();
  });

  it("does not render contract term when absent", () => {
    render(
      <AccountSection
        account={createAccount({ contractTerm: undefined })}
      />
    );
    expect(screen.queryByText(/Feb/)).not.toBeInTheDocument();
  });

  it("sorts items with unparseable targets before no-target items", () => {
    const { container } = render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "No Date", status: "in-production", category: "active" },
            { id: "p2", title: "Vague", status: "in-production", category: "active", target: "Late March" },
            { id: "p3", title: "Exact", status: "in-production", category: "active", target: "4/15" },
          ],
        })}
      />
    );
    const text = container.textContent!;
    expect(text.indexOf("Exact")).toBeLessThan(text.indexOf("Vague"));
    expect(text.indexOf("Vague")).toBeLessThan(text.indexOf("No Date"));
  });

  it("sorts by first date when target has a date range", () => {
    const { container } = render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "Later", status: "in-production", category: "active", target: "4/10-4/22 dev window" },
            { id: "p2", title: "Earlier", status: "in-production", category: "active", target: "4/8" },
          ],
        })}
      />
    );
    const text = container.textContent!;
    expect(text.indexOf("Earlier")).toBeLessThan(text.indexOf("Later"));
  });

  it("does not show short date for text-only targets", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "Vague Item", status: "in-production", category: "active", target: "Late March" },
          ],
        })}
      />
    );
    // Should show the full target in metadata but no short date on the right
    expect(screen.getByText("Target: Late March")).toBeInTheDocument();
    // No standalone short date element
    const allText = screen.getByText("Vague Item").closest("div")!.parentElement!;
    const spans = Array.from(allText.querySelectorAll("span"));
    const dateSpans = spans.filter((s) => /^\d{1,2}\/\d{1,2}$/.test(s.textContent ?? ""));
    expect(dateSpans).toHaveLength(0);
  });
});
