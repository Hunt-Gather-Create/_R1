import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import {
  AuditBadge,
  formatIssuesForClipboard,
  type AuditIssue,
} from "./audit-badge";
import type { SeverityCounts } from "@/lib/runway/gantt/types";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }),
}));

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

// #76 — Audit pill open-state: copy-to-clipboard for triage handoff.
// Standup lead opens the panel, clicks the copy glyph, pastes the full
// issue list into Slack / docs without manual transcription.
describe("AuditBadge — clipboard copy (#76)", () => {
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

  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    toastError.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("formatIssuesForClipboard helper", () => {
    it("formats critical + warn issues with bracketed severity, section, code, and message/refs", () => {
      const out = formatIssuesForClipboard(makeIssues());
      expect(out).toBe(
        [
          "[CRITICAL] Brand Refresh — wrapper-null-dates: Wrapper has children but startDate is null.",
          "[WARNING] Brand Refresh — child-active-null-owner: Active Child A, Active Child B",
          "[CRITICAL] Comms Retainer — row-end-before-start: Bad Range Task",
        ].join("\n"),
      );
    });

    it("emits [INFO] prefix for info-level issues", () => {
      expect(
        formatIssuesForClipboard([
          {
            sectionTitle: "S",
            severity: "info",
            code: "noted",
            message: "ok",
          },
        ]),
      ).toBe("[INFO] S — noted: ok");
    });

    it("omits the section prefix when sectionTitle is empty", () => {
      expect(
        formatIssuesForClipboard([
          { severity: "critical", code: "loose", message: "no anchor" },
        ]),
      ).toBe("[CRITICAL] loose: no anchor");
    });

    it("renders empty list as an empty string (no crash, no extra newlines)", () => {
      expect(formatIssuesForClipboard([])).toBe("");
    });
  });

  it("renders the copy button only when the panel is open", () => {
    render(
      <AuditBadge severity={counts({ critical: 1 })} issues={makeIssues()} />,
    );
    expect(screen.queryByTestId("audit-badge-copy")).toBeNull();
    fireEvent.click(screen.getByTestId("audit-badge"));
    expect(screen.getByTestId("audit-badge-copy")).toBeInTheDocument();
  });

  it("copy button has the documented aria-label and is a real <button>", () => {
    render(
      <AuditBadge severity={counts({ critical: 1 })} issues={makeIssues()} />,
    );
    fireEvent.click(screen.getByTestId("audit-badge"));
    const copy = screen.getByTestId("audit-badge-copy");
    expect(copy.tagName.toLowerCase()).toBe("button");
    expect(copy).toHaveAttribute("aria-label", "Copy issues to clipboard");
  });

  it("clicking copy calls navigator.clipboard.writeText with the formatted multi-line payload", async () => {
    render(
      <AuditBadge severity={counts({ critical: 2, warn: 1 })} issues={makeIssues()} />,
    );
    fireEvent.click(screen.getByTestId("audit-badge"));
    fireEvent.click(screen.getByTestId("audit-badge-copy"));
    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload.split("\n")).toHaveLength(3);
    expect(payload).toContain("[CRITICAL] Brand Refresh — wrapper-null-dates");
    expect(payload).toContain("[WARNING] Brand Refresh — child-active-null-owner");
    expect(payload).toContain("[CRITICAL] Comms Retainer — row-end-before-start");
  });

  it("flashes a checkmark glyph for ~1s on successful copy, then reverts to the clipboard glyph", async () => {
    vi.useFakeTimers();
    render(
      <AuditBadge severity={counts({ critical: 1 })} issues={makeIssues()} />,
    );
    fireEvent.click(screen.getByTestId("audit-badge"));
    const copy = screen.getByTestId("audit-badge-copy");
    expect(copy).toHaveAttribute("data-state", "idle");
    await act(async () => {
      fireEvent.click(copy);
      // Let the writeText promise resolve.
      await Promise.resolve();
    });
    expect(copy).toHaveAttribute("data-state", "copied");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(copy).toHaveAttribute("data-state", "idle");
  });

  it("surfaces a 'Copy failed' error toast and stays in idle state when writeText rejects", async () => {
    writeText.mockRejectedValue(new Error("permission"));
    render(
      <AuditBadge severity={counts({ critical: 1 })} issues={makeIssues()} />,
    );
    fireEvent.click(screen.getByTestId("audit-badge"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("audit-badge-copy"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toastError).toHaveBeenCalledWith("Copy failed — try again.");
    expect(screen.getByTestId("audit-badge-copy")).toHaveAttribute(
      "data-state",
      "idle",
    );
  });
});
