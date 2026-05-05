import { describe, it, expect } from "vitest";
import { groupSections, type SectionBlock } from "./group-sections";
import type { RundownSection, GanttData } from "./types";

// Minimal stub for GanttData — group-sections.ts never reads inside `data`,
// so we type-assert through `unknown` rather than fixturing every nested
// field. Keeps these tests narrowly focused on the grouping algorithm.
const stubData = {} as unknown as GanttData;

function makeSection(
  kind: RundownSection["kind"],
  title: string,
  parentTitle?: string,
): RundownSection {
  return {
    anchor: title.toLowerCase().replace(/\s+/g, "-"),
    kind,
    title,
    parentTitle,
    data: stubData,
  };
}

describe("groupSections", () => {
  it("returns an empty array for empty input", () => {
    expect(groupSections([])).toEqual([]);
  });

  it("emits a single standalone block for one standalone section", () => {
    const s = makeSection("standalone", "Solo L1");
    const result = groupSections([s]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: "standalone", section: s });
  });

  it("collapses a wrapper + wrapper-children run into one wrapper block", () => {
    const wrapper = makeSection("wrapper", "Q2 Retainer");
    const c1 = makeSection("wrapper-child", "Sub A", "Q2 Retainer");
    const c2 = makeSection("wrapper-child", "Sub B", "Q2 Retainer");
    const result = groupSections([wrapper, c1, c2]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: "wrapper",
      wrapper,
      children: [c1, c2],
    });
  });

  it("emits a wrapper block + standalone block when a standalone follows a wrapper run", () => {
    const wrapper = makeSection("wrapper", "Q2 Retainer");
    const c1 = makeSection("wrapper-child", "Sub A", "Q2 Retainer");
    const solo = makeSection("standalone", "Solo L1");
    const result = groupSections([wrapper, c1, solo]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      kind: "wrapper",
      wrapper,
      children: [c1],
    });
    expect(result[1]).toEqual({ kind: "standalone", section: solo });
  });

  it("opens a new wrapper block when a second wrapper follows the first", () => {
    const w1 = makeSection("wrapper", "Q2 Retainer");
    const c1 = makeSection("wrapper-child", "Sub A", "Q2 Retainer");
    const w2 = makeSection("wrapper", "Q3 Retainer");
    const c2 = makeSection("wrapper-child", "Sub B", "Q3 Retainer");
    const result = groupSections([w1, c1, w2, c2]);
    expect(result).toHaveLength(2);
    expect((result[0] as Extract<SectionBlock, { kind: "wrapper" }>).wrapper).toBe(w1);
    expect((result[0] as Extract<SectionBlock, { kind: "wrapper" }>).children).toEqual([c1]);
    expect((result[1] as Extract<SectionBlock, { kind: "wrapper" }>).wrapper).toBe(w2);
    expect((result[1] as Extract<SectionBlock, { kind: "wrapper" }>).children).toEqual([c2]);
  });

  it("demotes a wrapper-child appearing before any wrapper to standalone (malformed input guard)", () => {
    const orphan = makeSection("wrapper-child", "Orphan Child");
    const wrapper = makeSection("wrapper", "Q2 Retainer");
    const c1 = makeSection("wrapper-child", "Sub A", "Q2 Retainer");
    const result = groupSections([orphan, wrapper, c1]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: "standalone", section: orphan });
    expect(result[1]).toEqual({
      kind: "wrapper",
      wrapper,
      children: [c1],
    });
  });

  it("preserves left-to-right order across mixed standalone + wrapper sequences", () => {
    const s1 = makeSection("standalone", "Solo A");
    const w = makeSection("wrapper", "Q2 Retainer");
    const c = makeSection("wrapper-child", "Sub A", "Q2 Retainer");
    const s2 = makeSection("standalone", "Solo B");
    const result = groupSections([s1, w, c, s2]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: "standalone", section: s1 });
    expect((result[1] as Extract<SectionBlock, { kind: "wrapper" }>).wrapper).toBe(w);
    expect((result[1] as Extract<SectionBlock, { kind: "wrapper" }>).children).toEqual([c]);
    expect(result[2]).toEqual({ kind: "standalone", section: s2 });
  });

  it("emits an empty children array for a wrapper with no following children", () => {
    const wrapper = makeSection("wrapper", "Bare Wrapper");
    const solo = makeSection("standalone", "Solo");
    const result = groupSections([wrapper, solo]);
    expect(result).toHaveLength(2);
    expect((result[0] as Extract<SectionBlock, { kind: "wrapper" }>).children).toEqual([]);
  });
});
