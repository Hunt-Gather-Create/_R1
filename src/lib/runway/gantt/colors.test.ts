/**
 * Color token tests -- dashboard-cleanup item 10.
 *
 * Asserts:
 * 1. Every theme defines every status (completeness).
 * 2. Token values match the inline hex values currently used in
 *    GanttTemplate.tsx and gantt-dark-embed.module.css.
 */

import { describe, it, expect } from "vitest";
import {
  GANTT_STATUS_COLORS,
  barBg,
  barBorder,
  type GanttTheme,
  type GanttStatus,
} from "./colors";

const THEMES: GanttTheme[] = ["light-internal", "light-branded", "dark-account"];
const STATUSES: GanttStatus[] = ["active", "scheduled", "at-risk", "blocked", "completed", "canceled"];

describe("GANTT_STATUS_COLORS", () => {
  it("defines every status for every theme (completeness)", () => {
    for (const theme of THEMES) {
      for (const status of STATUSES) {
        const entry = GANTT_STATUS_COLORS[theme][status];
        expect(entry, `${theme}.${status} should be defined`).toBeDefined();
        expect(typeof entry.bar).toBe("string");
        expect(entry.bar.length, `${theme}.${status}.bar should not be empty`).toBeGreaterThan(0);
        expect(typeof entry.legendBg).toBe("string");
      }
    }
  });

  // light-internal -- dashboard-cleanup item 11 color scheme
  describe("light-internal token values (item 11 updated scheme)", () => {
    const li = GANTT_STATUS_COLORS["light-internal"];

    it("active bar = #3b82f6 (unchanged)", () => {
      expect(li.active.bar).toBe("#3b82f6");
    });

    it("scheduled bar = #06b6d4 (teal solid -- item 11)", () => {
      expect(li.scheduled.bar).toBe("#06b6d4");
      expect(li.scheduled.barBorder).toBeUndefined();
    });

    it("at-risk bar = #f59e0b (unchanged)", () => {
      expect(li["at-risk"].bar).toBe("#f59e0b");
    });

    it("blocked bar = #ef4444 (unchanged)", () => {
      expect(li.blocked.bar).toBe("#ef4444");
    });

    it("completed bar = #cbd5e1 (muted slate -- item 11)", () => {
      expect(li.completed.bar).toBe("#cbd5e1");
      expect(li.completed.barBorder).toBe("1px solid #94a3b8");
    });

    it("completed row text = #94a3b8 (lighter slate -- item 11)", () => {
      expect(li.completed.rowText).toBe("#94a3b8");
    });

    it("canceled row text = #94a3b8 (unchanged)", () => {
      expect(li.canceled.rowText).toBe("#94a3b8");
    });
  });

  // light-branded -- dashboard-cleanup item 11 color scheme
  describe("light-branded token values (item 11 updated scheme)", () => {
    const lb = GANTT_STATUS_COLORS["light-branded"];

    it("active bar = #0E5DFF (Civ brand blue, unchanged)", () => {
      expect(lb.active.bar).toBe("#0E5DFF");
    });

    it("scheduled bar = #0891B2 (teal solid -- item 11)", () => {
      expect(lb.scheduled.bar).toBe("#0891B2");
      expect(lb.scheduled.barBorder).toBeUndefined();
    });

    it("at-risk bar = #F59E0B (unchanged)", () => {
      expect(lb["at-risk"].bar).toBe("#F59E0B");
    });

    it("blocked bar = #DC2626 (unchanged)", () => {
      expect(lb.blocked.bar).toBe("#DC2626");
    });

    it("completed bar = #CBD5E1 (muted slate -- item 11)", () => {
      expect(lb.completed.bar).toBe("#CBD5E1");
      expect(lb.completed.barBorder).toBe("1px solid #94A3B8");
    });

    it("canceled bar = #9CA3AF (flat gray, unchanged)", () => {
      expect(lb.canceled.bar).toBe("#9CA3AF");
    });
  });

  // dark-account theme -- CSS variables (resolved in gantt-dark-embed.module.css)
  describe("dark-account theme entries are defined", () => {
    const da = GANTT_STATUS_COLORS["dark-account"];

    it("active is defined", () => {
      expect(da.active.bar).toBeDefined();
    });

    it("scheduled is defined", () => {
      expect(da.scheduled.bar).toBeDefined();
    });

    it("at-risk is defined", () => {
      expect(da["at-risk"].bar).toBeDefined();
    });

    it("blocked is defined", () => {
      expect(da.blocked.bar).toBeDefined();
    });

    it("completed is defined", () => {
      expect(da.completed.bar).toBeDefined();
    });

    it("canceled is defined", () => {
      expect(da.canceled.bar).toBeDefined();
    });
  });
});

describe("barBg helper", () => {
  it("returns the bar value for the given theme + status", () => {
    expect(barBg("light-internal", "active")).toBe("#3b82f6");
    expect(barBg("light-branded", "active")).toBe("#0E5DFF");
  });
});

describe("barBorder helper", () => {
  it("returns the border string when present (completed has a border)", () => {
    // item 11: completed has a subtle slate border
    expect(barBorder("light-internal", "completed")).toBe("1px solid #94a3b8");
  });

  it("returns empty string when no border is set", () => {
    expect(barBorder("light-internal", "active")).toBe("");
    expect(barBorder("light-internal", "blocked")).toBe("");
    // item 11: scheduled is now solid teal, no border
    expect(barBorder("light-internal", "scheduled")).toBe("");
  });
});
