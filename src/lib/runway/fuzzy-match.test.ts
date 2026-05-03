import { describe, it, expect } from "vitest";
import { sorensenDice, fuzzyMatchCandidates } from "./fuzzy-match";

describe("sorensenDice", () => {
  it("returns 1.0 for exact match", () => {
    expect(sorensenDice("AG1 Pro", "AG1 Pro")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(sorensenDice("AG1 Pro", "ag1 pro")).toBe(1);
  });

  it("trims surrounding whitespace", () => {
    expect(sorensenDice("  AG1 Pro  ", "AG1 Pro")).toBe(1);
  });

  it("returns low score for unrelated strings", () => {
    // "Convergix" vs "Bonterra" share a couple of incidental bigrams ("on")
    // — score is low but not zero. Empirically ~0.27.
    const score = sorensenDice("Convergix", "Bonterra");
    expect(score).toBeLessThan(0.4);
  });

  it("returns 0 for completely disjoint short strings", () => {
    expect(sorensenDice("ab", "cd")).toBe(0);
  });

  it("returns intermediate score for partial overlap", () => {
    // "AG1 Pro" vs "AG1 Pro Subscriber 2026" — shared bigrams from "AG1 Pro "
    const score = sorensenDice("AG1 Pro", "AG1 Pro Subscriber 2026");
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(1);
  });

  it("handles single-char inputs (length < 2 fallback)", () => {
    expect(sorensenDice("a", "a")).toBe(1);
    expect(sorensenDice("a", "b")).toBe(0);
    expect(sorensenDice("a", "ab")).toBe(0);
  });

  it("handles empty strings (length < 2 fallback)", () => {
    expect(sorensenDice("", "")).toBe(1);
    expect(sorensenDice("", "a")).toBe(0);
  });

  it("handles unicode characters", () => {
    expect(sorensenDice("café", "café")).toBe(1);
    expect(sorensenDice("café", "cafe")).toBeGreaterThan(0.3);
  });

  it("counts duplicate bigrams correctly", () => {
    // "aaaa" vs "aaa" — bigrams of "aaaa" = aa,aa,aa (3 of "aa"); "aaa" = aa,aa (2)
    // intersect = min(3,2) = 2; total = 3 + 2 = 5; score = 4/5 = 0.8
    expect(sorensenDice("aaaa", "aaa")).toBeCloseTo(0.8, 2);
  });
});

describe("fuzzyMatchCandidates", () => {
  type Project = { id: string; name: string };
  const projects: Project[] = [
    { id: "p1", name: "AG1 Pro" },
    { id: "p2", name: "AG1 Pro Subscriber 2026" },
    { id: "p3", name: "Convergix CDS Messaging" },
    { id: "p4", name: "Bonterra Brand Refresh" },
  ];

  it("returns single candidate matching above default threshold", () => {
    const matches = fuzzyMatchCandidates(
      "Convergix CDS",
      projects,
      (p) => p.name,
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.id === "p3")).toBe(true);
  });

  it("returns multiple candidates above threshold", () => {
    // Threshold 0.4 lets both "AG1 Pro" (1.0) and "AG1 Pro Subscriber 2026"
    // (~0.43) clear; unrelated entries score near zero and stay out.
    const matches = fuzzyMatchCandidates("AG1 Pro", projects, (p) => p.name, 0.4);
    expect(matches.length).toBe(2);
    expect(matches.map((m) => m.id).sort()).toEqual(["p1", "p2"]);
  });

  it("returns empty array when no candidate clears threshold", () => {
    const matches = fuzzyMatchCandidates(
      "ZZZ unrelated",
      projects,
      (p) => p.name,
    );
    expect(matches).toHaveLength(0);
  });

  it("respects custom higher threshold (0.9)", () => {
    // "AG1 Pro" alone clears 0.9 only against "AG1 Pro" exact match
    const matches = fuzzyMatchCandidates("AG1 Pro", projects, (p) => p.name, 0.9);
    expect(matches.map((m) => m.id)).toEqual(["p1"]);
  });

  it("respects custom lower threshold (0.2)", () => {
    const matches = fuzzyMatchCandidates(
      "Convergix",
      projects,
      (p) => p.name,
      0.2,
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
