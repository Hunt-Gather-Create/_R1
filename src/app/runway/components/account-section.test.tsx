import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AccountSection } from "./account-section";
import type { Account, TriageItem } from "../types";

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
  it("renders account name and contract term", () => {
    render(<AccountSection account={createAccount()} />);
    expect(screen.getByText("Convergix")).toBeInTheDocument();
    expect(screen.getByText("Feb – Jul 2026")).toBeInTheDocument();
  });

  it("does NOT render contract value on By Account view (prices moved to Pipeline)", () => {
    render(<AccountSection account={createAccount({ contractValue: "$100K" })} />);
    expect(screen.queryByText("$100K")).not.toBeInTheDocument();
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

  it("renders owner and notes for items", () => {
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
              notes: "Gate for content",
            },
          ],
        })}
      />
    );
    expect(screen.getByText("Resources: Kathy")).toBeInTheDocument();
    expect(screen.getByText("Gate for content")).toBeInTheDocument();
  });

  it("shows resources prominently and owner muted when they differ", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "p1",
              title: "Team Item",
              status: "in-production",
              category: "active",
              owner: "Kathy",
              resources: "Kathy + Lane",
            },
          ],
        })}
      />
    );
    expect(screen.getByText("Resources: Kathy + Lane")).toBeInTheDocument();
    expect(screen.getByText("Owner: Kathy")).toBeInTheDocument();
  });

  it("shows only resources when resources equals owner", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "p1",
              title: "Solo Item",
              status: "in-production",
              category: "active",
              owner: "Kathy",
              resources: "Kathy",
            },
          ],
        })}
      />
    );
    expect(screen.getByText("Resources: Kathy")).toBeInTheDocument();
    expect(screen.queryByText("Owner: Kathy")).not.toBeInTheDocument();
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

  it("sorts active items by startDate, with no-startDate items at the end", () => {
    const { container } = render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "Later", status: "in-production", category: "active", startDate: "2026-05-01" },
            { id: "p2", title: "Earlier", status: "in-production", category: "active", startDate: "2026-04-08" },
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

  it("keeps items without startDate after items with startDate", () => {
    const { container } = render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "No Date", status: "in-production", category: "active" },
            { id: "p2", title: "Exact", status: "in-production", category: "active", startDate: "2026-04-15" },
          ],
        })}
      />
    );
    const text = container.textContent!;
    expect(text.indexOf("Exact")).toBeLessThan(text.indexOf("No Date"));
  });

  it("sorts by startDate ISO order when both items have one", () => {
    const { container } = render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "Later", status: "in-production", category: "active", startDate: "2026-04-10" },
            { id: "p2", title: "Earlier", status: "in-production", category: "active", startDate: "2026-04-08" },
          ],
        })}
      />
    );
    const text = container.textContent!;
    expect(text.indexOf("Earlier")).toBeLessThan(text.indexOf("Later"));
  });

  // Chunk 3 #1 — unified Project View
  it("renders inline L2 milestones when provided via unified shape", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "p1",
              title: "Impact Report",
              status: "in-production",
              category: "active",
              milestones: [
                { title: "Design Presentation", account: "Bonterra", type: "delivery", status: "in-progress" },
                { title: "Dev Handoff", account: "Bonterra", type: "delivery" },
              ],
            },
          ],
        })}
      />
    );
    const list = screen.getByTestId("project-milestones");
    expect(list).toHaveTextContent("Design Presentation");
    expect(list).toHaveTextContent("(in-progress)");
    expect(list).toHaveTextContent("Dev Handoff");
  });

  it("does not render milestones list when items have no milestones", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "Project A", status: "in-production", category: "active" },
          ],
        })}
      />
    );
    expect(screen.queryByTestId("project-milestones")).not.toBeInTheDocument();
  });

  // ── Retainer wrapper 3-level hierarchy (PR #88 Chunk F) ──

  function makeChild(id: string, title: string): TriageItem {
    return { id, title, status: "in-production", category: "active" };
  }

  it("falls back to 2-level render when parentProjectId is null (no children attached)", () => {
    // Zero visual change from the pre-Chunk-F behavior for top-level L1s.
    render(
      <AccountSection
        account={createAccount({
          items: [
            { id: "p1", title: "Standalone Project", status: "in-production", category: "active" },
          ],
        })}
      />
    );
    expect(screen.getByText("Standalone Project")).toBeInTheDocument();
    expect(screen.queryByTestId("project-wrapper-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-wrapper-toggle")).not.toBeInTheDocument();
  });

  it("renders 3-level hierarchy when a wrapper has children", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "wrap",
              title: "Convergix Retainer 2026",
              status: "in-production",
              category: "active",
              children: [
                makeChild("c1", "CDS Messaging"),
                makeChild("c2", "CDS Landing Page"),
              ],
            } as TriageItem,
          ],
        })}
      />
    );
    expect(screen.getByText("Convergix Retainer 2026")).toBeInTheDocument();
    const card = screen.getByTestId("project-wrapper-card");
    expect(card).toBeInTheDocument();
    const childrenList = screen.getByTestId("project-wrapper-children");
    expect(childrenList).toHaveTextContent("CDS Messaging");
    expect(childrenList).toHaveTextContent("CDS Landing Page");
  });

  it("auto-expands wrappers with fewer than 5 children (toggle reads 'Collapse')", () => {
    render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "wrap",
              title: "Small Retainer",
              status: "in-production",
              category: "active",
              children: [makeChild("c1", "Child 1"), makeChild("c2", "Child 2")],
            } as TriageItem,
          ],
        })}
      />
    );
    expect(screen.getByTestId("project-wrapper-children")).toBeInTheDocument();
    expect(screen.getByTestId("project-wrapper-toggle")).toHaveTextContent("Collapse");
  });

  it("auto-collapses wrappers with 5+ children by default (PR #88 Chunk F)", () => {
    const children = Array.from({ length: 6 }, (_, i) =>
      makeChild(`c${i}`, `Child ${i}`),
    );
    render(
      <AccountSection
        account={createAccount({
          items: [
            {
              id: "wrap",
              title: "Big Retainer",
              status: "in-production",
              category: "active",
              children,
            } as TriageItem,
          ],
        })}
      />
    );
    // Collapsed: children list not rendered, toggle invites expansion.
    expect(screen.queryByTestId("project-wrapper-children")).not.toBeInTheDocument();
    const toggle = screen.getByTestId("project-wrapper-toggle");
    expect(toggle).toHaveTextContent("Expand (6)");

    // Clicking expands.
    fireEvent.click(toggle);
    expect(screen.getByTestId("project-wrapper-children")).toBeInTheDocument();
    expect(toggle).toHaveTextContent("Collapse");
  });

  describe("Outside retainer marker", () => {
    function makeItem(overrides: Partial<TriageItem> = {}): TriageItem {
      return {
        id: "p",
        title: "Project",
        status: "in-production",
        category: "active",
        ...overrides,
      };
    }

    it("marks standalone L1s when the account has a retainer wrapper", () => {
      const account = createAccount({
        items: [
          makeItem({ id: "wrap", title: "Convergix Retainer", engagementType: "retainer" }),
          makeItem({ id: "c1", title: "Monthly touchpoint", parentProjectId: "wrap" }),
          makeItem({ id: "solo", title: "AUTOMATE Booth Design", parentProjectId: null, engagementType: "project" }),
        ],
      });
      render(<AccountSection account={account} />);
      const markers = screen.getAllByTestId("outside-retainer-marker");
      expect(markers).toHaveLength(1);
    });

    it("does NOT mark anything when the account has no retainer wrapper", () => {
      const account = createAccount({
        items: [
          makeItem({ id: "p1", title: "Project A" }),
          makeItem({ id: "p2", title: "Project B" }),
        ],
      });
      render(<AccountSection account={account} />);
      expect(screen.queryAllByTestId("outside-retainer-marker")).toHaveLength(0);
    });

    it("does NOT mark the wrapper itself or its children", () => {
      const account = createAccount({
        items: [
          makeItem({ id: "wrap", title: "Convergix Retainer", engagementType: "retainer" }),
          makeItem({ id: "c1", title: "Child 1", parentProjectId: "wrap" }),
          makeItem({ id: "c2", title: "Child 2", parentProjectId: "wrap" }),
        ],
      });
      render(<AccountSection account={account} />);
      expect(screen.queryAllByTestId("outside-retainer-marker")).toHaveLength(0);
    });
  });

  describe("Wrapper render shape (regression guard)", () => {
    function makeItem(overrides: Partial<TriageItem> = {}): TriageItem {
      return {
        id: "p",
        title: "Project",
        status: "in-production",
        category: "active",
        ...overrides,
      };
    }

    it("renders 1 wrapper card + 3 nested children cards", () => {
      const wrapper = makeItem({
        id: "wrap",
        title: "Convergix Retainer",
        engagementType: "retainer",
      });
      const children = [
        makeItem({ id: "c1", title: "Brand Guide v2", parentProjectId: "wrap" }),
        makeItem({ id: "c2", title: "Fanuc Article", parentProjectId: "wrap" }),
        makeItem({ id: "c3", title: "Social Playbook", parentProjectId: "wrap" }),
      ];
      const unifiedAccount = {
        ...createAccount(),
        items: [{ ...wrapper, children }],
      };
      render(<AccountSection account={unifiedAccount} />);
      // One wrapper card at the top.
      expect(screen.getAllByTestId("project-wrapper-card")).toHaveLength(1);
      // Three children rendered inside the wrapper's <ul>.
      const childrenList = screen.getByTestId("project-wrapper-children");
      const childItems = childrenList.querySelectorAll("li");
      expect(childItems).toHaveLength(3);
      // Wrapper + all child titles visible.
      expect(screen.getByText("Convergix Retainer")).toBeInTheDocument();
      expect(screen.getByText("Brand Guide v2")).toBeInTheDocument();
      expect(screen.getByText("Fanuc Article")).toBeInTheDocument();
      expect(screen.getByText("Social Playbook")).toBeInTheDocument();
    });
  });
});
