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

  // light-internal -- assert token values match GanttTemplate.tsx STYLES inline hex
  describe("light-internal token values match GanttTemplate.tsx STYLES", () => {
    const li = GANTT_STATUS_COLORS["light-internal"];

    it("active bar = #3b82f6", () => {
      expect(li.active.bar).toBe("#3b82f6");
    });

    it("scheduled bar = #eff6ff (dashed pale blue)", () => {
      expect(li.scheduled.bar).toBe("#eff6ff");
      expect(li.scheduled.barBorder).toBe("1px dashed #93c5fd");
    });

    it("at-risk bar = #f59e0b", () => {
      expect(li["at-risk"].bar).toBe("#f59e0b");
    });

    it("blocked bar = #ef4444", () => {
      expect(li.blocked.bar).toBe("#ef4444");
    });

    it("completed bar = #86efac with green border", () => {
      expect(li.completed.bar).toBe("#86efac");
      expect(li.completed.barBorder).toBe("1px solid #4ade80");
    });

    it("completed row text = #475569 (muted slate)", () => {
      expect(li.completed.rowText).toBe("#475569");
    });

    it("canceled row text = #94a3b8 (strikethrough slate)", () => {
      expect(li.canceled.rowText).toBe("#94a3b8");
    });
  });

  // light-branded -- assert token values match GanttTemplate.tsx STYLES_BRANDED
  describe("light-branded token values match GanttTemplate.tsx STYLES_BRANDED", () => {
    const lb = GANTT_STATUS_COLORS["light-branded"];

    it("active bar = #0E5DFF (Civ brand blue)", () => {
      expect(lb.active.bar).toBe("#0E5DFF");
    });

    it("scheduled bar = #F9FAFB with dashed gray border", () => {
      expect(lb.scheduled.bar).toBe("#F9FAFB");
      expect(lb.scheduled.barBorder).toBe("1px dashed #D1D5DB");
    });

    it("at-risk bar = #F59E0B", () => {
      expect(lb["at-risk"].bar).toBe("#F59E0B");
    });

    it("blocked bar = #DC2626", () => {
      expect(lb.blocked.bar).toBe("#DC2626");
    });

    it("completed bar = #10B981 with green border", () => {
      expect(lb.completed.bar).toBe("#10B981");
      expect(lb.completed.barBorder).toBe("1px solid #059669");
    });

    it("canceled bar = #9CA3AF (flat gray)", () => {
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
  it("returns the border string when present", () => {
    expect(barBorder("light-internal", "scheduled")).toBe("1px dashed #93c5fd");
  });

  it("returns empty string when no border is set", () => {
    expect(barBorder("light-internal", "active")).toBe("");
    expect(barBorder("light-internal", "blocked")).toBe("");
  });
});
