import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AuditBadge, type AuditIssue } from "./audit-badge";
import type { SeverityCounts } from "@/lib/runway/gantt/types";

function counts(overrides: Partial<SeverityCounts> = {}): SeverityCounts {
  return { critical: 0, warn: 0, info: 0, ...overrides };
}

describe("AuditBadge", () => {
  it("returns null for clean severity (0 critical, 0 warn)", () => {
    const { container } = render(<AuditBadge severity={counts()} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null for info-only severity (0 critical, 0 warn, some info)", () => {
    const { container } = render(<AuditBadge severity={counts({ info: 5 })} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders amber warn badge for warn-only severity (plural)", () => {
    render(<AuditBadge severity={counts({ warn: 3 })} />);
    const badge = screen.getByTestId("audit-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-severity", "warn");
    expect(badge).toHaveTextContent("3 warnings");
    expect(badge.className).toContain("text-amber-300");
  });

  it("renders amber warn badge for singular warn (1 warning)", () => {
    render(<AuditBadge severity={counts({ warn: 1 })} />);
    const badge = screen.getByTestId("audit-badge");
    expect(badge).toHaveAttribute("data-severity", "warn");
    expect(badge).toHaveTextContent("1 warning");
  });

  it("renders red critical badge with compound label for critical+warn", () => {
    render(<AuditBadge severity={counts({ critical: 2, warn: 4 })} />);
    const badge = screen.getByTestId("audit-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-severity", "critical");
    expect(badge).toHaveTextContent("2 critical, 4 warnings");
    expect(badge.className).toContain("text-red-300");
  });

  it("renders red critical badge with simple label when warn is 0", () => {
    render(<AuditBadge severity={counts({ critical: 1 })} />);
    const badge = screen.getByTestId("audit-badge");
    expect(badge).toHaveAttribute("data-severity", "critical");
    expect(badge).toHaveTextContent("1 critical");
    expect(badge.className).not.toContain("warn");
  });

  it("has tooltip title 'View details locally' in static mode (no issues passed)", () => {
    render(<AuditBadge severity={counts({ warn: 1 })} />);
    const badge = screen.getByTestId("audit-badge");
    expect(badge).toHaveAttribute("title", "View details locally");
  });

  it("stays static when issues prop is an empty array", () => {
    render(<AuditBadge severity={counts({ warn: 1 })} issues={[]} />);
    const badge = screen.getByTestId("audit-badge");
    expect(badge.tagName.toLowerCase()).toBe("span");
  });
});

describe("AuditBadge — interactive (#66)", () => {
  function makeIssues(): AuditIssue[] {
    return [
      {
        sectionTitle: "Brand Refresh",
        severity: "critical",
        code: "wrapper-null-dates",
        message: "Wrapper has children but startDate is null.",
      },
      {
        sectionTitle: "Brand Refresh",
        severity: "warn",
        code: "child-active-null-owner",
        refs: [
          { id: "p-a", title: "Active Child A" },
          { id: "p-b", title: "Active Child B" },
        ],
      },
      {
        sectionTitle: "Comms Retainer",
        severity: "critical",
        code: "row-end-before-start",
        refs: [{ id: "w-1", title: "Bad Range Task" }],
      },
    ];
  }

  it("renders as a button (not a span) when issues are passed", () => {
    render(
      <AuditBadge severity={counts({ critical: 2, warn: 2 })} issues={makeIssues()} />,
    );
    const badge = screen.getByTestId("audit-badge");
    expect(badge.tagName.toLowerCase()).toBe("button");
    expect(badge).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and closes the panel on click", () => {
    render(
      <AuditBadge severity={counts({ critical: 2, warn: 2 })} issues={makeIssues()} />,
    );
    const badge = screen.getByTestId("audit-badge");
    expect(screen.queryByTestId("audit-badge-panel")).toBeNull();
    fireEvent.click(badge);
    expect(screen.getByTestId("audit-badge-panel")).toBeInTheDocument();
    expect(badge).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(badge);
    expect(screen.queryByTestId("audit-badge-panel")).toBeNull();
  });

  it("toggles the panel on Enter and Space", () => {
    render(
      <AuditBadge severity={counts({ warn: 1 })} issues={makeIssues()} />,
    );
    const badge = screen.getByTestId("audit-badge");
    fireEvent.keyDown(badge, { key: "Enter" });
    expect(screen.getByTestId("audit-badge-panel")).toBeInTheDocument();
    fireEvent.keyDown(badge, { key: " " });
    expect(screen.queryByTestId("audit-badge-panel")).toBeNull();
  });

  it("closes the panel on Escape", () => {
    render(
      <AuditBadge severity={counts({ critical: 1 })} issues={makeIssues()} />,
    );
    fireEvent.click(screen.getByTestId("audit-badge"));
    expect(screen.getByTestId("audit-badge-panel")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("audit-badge-panel")).toBeNull();
  });

  it("groups issues by section in the expanded panel", () => {
    render(
      <AuditBadge severity={counts({ critical: 2, warn: 1 })} issues={makeIssues()} />,
    );
    fireEvent.click(screen.getByTestId("audit-badge"));
    const panel = screen.getByTestId("audit-badge-panel");
    // Section headings rendered as uppercase chrome.
    expect(panel).toHaveTextContent("Brand Refresh");
    expect(panel).toHaveTextContent("Comms Retainer");
    // Issue codes rendered.
    expect(panel).toHaveTextContent("wrapper-null-dates");
    expect(panel).toHaveTextContent("child-active-null-owner");
    expect(panel).toHaveTextContent("row-end-before-start");
    // Row-level refs joined as titles.
    expect(panel).toHaveTextContent("Active Child A, Active Child B");
    expect(panel).toHaveTextContent("Bad Range Task");
    // Chart-level message rendered.
    expect(panel).toHaveTextContent(
      "Wrapper has children but startDate is null.",
    );
  });

  it("closes when clicking outside the badge container", () => {
    render(
      <div>
        <AuditBadge severity={counts({ warn: 1 })} issues={makeIssues()} />
        <button type="button" data-testid="outside">
          Outside
        </button>
      </div>,
    );
    fireEvent.click(screen.getByTestId("audit-badge"));
    expect(screen.getByTestId("audit-badge-panel")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("audit-badge-panel")).toBeNull();
  });
});
