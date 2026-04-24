import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { analyzeFlags } from "./flags";
import type { Account, DayItem, PipelineItem } from "@/app/runway/types";

// Fix "today" so deadline detection is deterministic
const FAKE_NOW = new Date("2026-04-07T12:00:00");
const TODAY_ISO = "2026-04-07";
const TOMORROW_ISO = "2026-04-08";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FAKE_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const emptyAccounts: Account[] = [];
const emptyWeek: DayItem[] = [];
const emptyPipeline: PipelineItem[] = [];

describe("analyzeFlags", () => {
  it("returns empty array for empty data", () => {
    const flags = analyzeFlags(emptyAccounts, emptyWeek, emptyWeek, emptyPipeline);
    expect(flags).toEqual([]);
  });

  // ── Resource Conflicts ───────────────────────────────────
  describe("resource conflicts", () => {
    it("flags person with 3+ items across 2+ clients", () => {
      const week: DayItem[] = [
        {
          date: TODAY_ISO, label: "Mon", items: [
            { title: "Task A", account: "Client A", owner: "Leslie", type: "delivery" },
            { title: "Task B", account: "Client B", owner: "Leslie", type: "review" },
          ],
        },
        {
          date: TOMORROW_ISO, label: "Tue", items: [
            { title: "Task C", account: "Client C", owner: "Leslie", type: "deadline" },
          ],
        },
      ];
      const flags = analyzeFlags(emptyAccounts, week, [], emptyPipeline);
      const conflict = flags.find((f) => f.type === "resource-conflict");
      expect(conflict).toBeDefined();
      expect(conflict!.title).toContain("Leslie");
      expect(conflict!.title).toContain("3 deliverables");
      expect(conflict!.detail).toContain("3 clients");
      expect(conflict!.relatedPerson).toBe("Leslie");
    });

    it("does NOT flag person with 3 items on 1 client", () => {
      const week: DayItem[] = [
        {
          date: TODAY_ISO, label: "Mon", items: [
            { title: "A", account: "Same Client", owner: "Leslie", type: "delivery" },
            { title: "B", account: "Same Client", owner: "Leslie", type: "review" },
            { title: "C", account: "Same Client", owner: "Leslie", type: "kickoff" },
          ],
        },
      ];
      const flags = analyzeFlags(emptyAccounts, week, [], emptyPipeline);
      expect(flags.filter((f) => f.type === "resource-conflict")).toHaveLength(0);
    });

    it("does NOT flag person with 2 items across 2 clients", () => {
      const week: DayItem[] = [
        {
          date: TODAY_ISO, label: "Mon", items: [
            { title: "A", account: "Client A", owner: "Leslie", type: "delivery" },
            { title: "B", account: "Client B", owner: "Leslie", type: "review" },
          ],
        },
      ];
      const flags = analyzeFlags(emptyAccounts, week, [], emptyPipeline);
      expect(flags.filter((f) => f.type === "resource-conflict")).toHaveLength(0);
    });

    it("excludes items beyond 10 days from resource conflict check", () => {
      const week: DayItem[] = [
        {
          date: TODAY_ISO, label: "Mon", items: [
            { title: "A", account: "Client A", owner: "Leslie", type: "delivery" },
            { title: "B", account: "Client B", owner: "Leslie", type: "review" },
          ],
        },
      ];
      const upcoming: DayItem[] = [
        {
          date: "2026-04-20", label: "Mon 4/20", items: [
            { title: "C", account: "Client C", owner: "Leslie", type: "delivery" },
          ],
        },
      ];
      const flags = analyzeFlags(emptyAccounts, week, upcoming, emptyPipeline);
      expect(flags.filter((f) => f.type === "resource-conflict")).toHaveLength(0);
    });
  });

  // ── Stale Items ──────────────────────────────────────────
  describe("stale items", () => {
    function daysAgoISO(days: number): string {
      return new Date(FAKE_NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    }

    it("flags items updatedAt >= 14 days ago as warning", () => {
      const accounts: Account[] = [
        {
          name: "Convergix", slug: "convergix", contractStatus: "signed",
          items: [
            { id: "p1", title: "Corporate Brochure", status: "awaiting-client", category: "active", updatedAt: daysAgoISO(14), waitingOn: "Daniel" },
          ],
        },
      ];
      const flags = analyzeFlags(accounts, emptyWeek, emptyWeek, emptyPipeline);
      const stale = flags.find((f) => f.type === "stale");
      expect(stale).toBeDefined();
      expect(stale!.severity).toBe("warning");
      expect(stale!.title).toContain("Corporate Brochure");
      expect(stale!.title).toContain("Daniel");
    });

    it("flags items updatedAt >= 30 days ago as critical", () => {
      const accounts: Account[] = [
        {
          name: "Convergix", slug: "convergix", contractStatus: "signed",
          items: [
            { id: "p1", title: "Old Project", status: "blocked", category: "active", updatedAt: daysAgoISO(45) },
          ],
        },
      ];
      const flags = analyzeFlags(accounts, emptyWeek, emptyWeek, emptyPipeline);
      const stale = flags.find((f) => f.type === "stale");
      expect(stale!.severity).toBe("critical");
    });

    it("does NOT flag items updatedAt < 14 days ago", () => {
      const accounts: Account[] = [
        {
          name: "Convergix", slug: "convergix", contractStatus: "signed",
          items: [
            { id: "p1", title: "Fresh Project", status: "in-production", category: "active", updatedAt: daysAgoISO(7) },
          ],
        },
      ];
      const flags = analyzeFlags(accounts, emptyWeek, emptyWeek, emptyPipeline);
      expect(flags.filter((f) => f.type === "stale")).toHaveLength(0);
    });
  });

  // ── Upcoming Deadlines ───────────────────────────────────
  describe("deadlines", () => {
    it("flags delivery items due today", () => {
      const week: DayItem[] = [
        {
          date: TODAY_ISO, label: "Mon", items: [
            { title: "CDS Messaging", account: "Convergix", type: "delivery" },
          ],
        },
      ];
      const flags = analyzeFlags(emptyAccounts, week, emptyWeek, emptyPipeline);
      const deadline = flags.find((f) => f.type === "deadline");
      expect(deadline).toBeDefined();
      expect(deadline!.severity).toBe("warning");
      expect(deadline!.detail).toBe("Due today");
    });

    it("flags deadline items due tomorrow", () => {
      const week: DayItem[] = [
        {
          date: TOMORROW_ISO, label: "Tue", items: [
            { title: "Report Due", account: "LPPC", type: "deadline" },
          ],
        },
      ];
      const flags = analyzeFlags(emptyAccounts, week, emptyWeek, emptyPipeline);
      const deadline = flags.find((f) => f.type === "deadline");
      expect(deadline).toBeDefined();
      expect(deadline!.severity).toBe("info");
      expect(deadline!.detail).toBe("Due tomorrow");
    });

    it("does NOT flag review items (only delivery/deadline)", () => {
      const week: DayItem[] = [
        {
          date: TODAY_ISO, label: "Mon", items: [
            { title: "Review Session", account: "Convergix", type: "review" },
          ],
        },
      ];
      const flags = analyzeFlags(emptyAccounts, week, emptyWeek, emptyPipeline);
      expect(flags.filter((f) => f.type === "deadline")).toHaveLength(0);
    });

    it("does NOT flag items on days after tomorrow", () => {
      const week: DayItem[] = [
        {
          date: "2026-04-09", label: "Thu", items: [
            { title: "Later Delivery", account: "Convergix", type: "delivery" },
          ],
        },
      ];
      const flags = analyzeFlags(emptyAccounts, week, emptyWeek, emptyPipeline);
      expect(flags.filter((f) => f.type === "deadline")).toHaveLength(0);
    });
  });

  // ── Bottlenecks ──────────────────────────────────────────
  describe("bottlenecks", () => {
    it("flags person as waitingOn on 3+ active items", () => {
      // v4: awaiting-client/blocked/on-hold/completed are excluded from
      // bottleneck counting. Use in-production + not-started here.
      const accounts: Account[] = [
        {
          name: "Client A", slug: "client-a", contractStatus: "signed",
          items: [
            { id: "1", title: "P1", status: "in-production", category: "active", waitingOn: "Daniel" },
            { id: "2", title: "P2", status: "not-started", category: "active", waitingOn: "Daniel" },
          ],
        },
        {
          name: "Client B", slug: "client-b", contractStatus: "signed",
          items: [
            { id: "3", title: "P3", status: "in-production", category: "active", waitingOn: "Daniel" },
          ],
        },
      ];
      const flags = analyzeFlags(accounts, emptyWeek, emptyWeek, emptyPipeline);
      const bottleneck = flags.find((f) => f.type === "bottleneck");
      expect(bottleneck).toBeDefined();
      expect(bottleneck!.title).toContain("Daniel");
      expect(bottleneck!.title).toContain("3 items");
    });

    it("does NOT flag person with only 2 waitingOn items", () => {
      const accounts: Account[] = [
        {
          name: "Client A", slug: "client-a", contractStatus: "signed",
          items: [
            { id: "1", title: "P1", status: "in-production", category: "active", waitingOn: "Daniel" },
            { id: "2", title: "P2", status: "in-production", category: "active", waitingOn: "Daniel" },
          ],
        },
      ];
      const flags = analyzeFlags(accounts, emptyWeek, emptyWeek, emptyPipeline);
      expect(flags.filter((f) => f.type === "bottleneck")).toHaveLength(0);
    });
  });

  // ── Sorting ──────────────────────────────────────────────
  it("sorts flags by severity: critical first, then warning, then info", () => {
    const veryOldISO = new Date(FAKE_NOW.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const somewhatOldISO = new Date(FAKE_NOW.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const accounts: Account[] = [
      {
        name: "Convergix", slug: "convergix", contractStatus: "signed",
        items: [
          { id: "p1", title: "Very Old", status: "blocked", category: "active", updatedAt: veryOldISO },
          { id: "p2", title: "Somewhat Old", status: "blocked", category: "active", updatedAt: somewhatOldISO },
        ],
      },
    ];
    const week: DayItem[] = [
      {
        date: TOMORROW_ISO, label: "Tue", items: [
          { title: "Report", account: "LPPC", type: "deadline" },
        ],
      },
    ];
    const flags = analyzeFlags(accounts, week, emptyWeek, emptyPipeline);
    expect(flags.length).toBeGreaterThanOrEqual(3);
    expect(flags[0].severity).toBe("critical");
    // All criticals before warnings
    const criticalEnd = flags.findIndex((f) => f.severity !== "critical");
    const warningEnd = flags.findIndex((f, i) => i >= criticalEnd && f.severity !== "warning");
    if (warningEnd !== -1) {
      expect(flags[warningEnd].severity).toBe("info");
    }
  });

  it("generates stable IDs for the same flag data", () => {
    const oldISO = new Date(FAKE_NOW.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const accounts: Account[] = [
      {
        name: "Convergix", slug: "convergix", contractStatus: "signed",
        items: [
          { id: "p1", title: "Old Project", status: "blocked", category: "active", updatedAt: oldISO },
        ],
      },
    ];
    const flags1 = analyzeFlags(accounts, emptyWeek, emptyWeek, emptyPipeline);
    const flags2 = analyzeFlags(accounts, emptyWeek, emptyWeek, emptyPipeline);
    expect(flags1[0].id).toBe(flags2[0].id);
  });
});
