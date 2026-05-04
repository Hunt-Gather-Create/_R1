import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditBadge } from "./audit-badge";
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

  it("has tooltip title 'View details locally'", () => {
    render(<AuditBadge severity={counts({ warn: 1 })} />);
    const badge = screen.getByTestId("audit-badge");
    expect(badge).toHaveAttribute("title", "View details locally");
  });
});
