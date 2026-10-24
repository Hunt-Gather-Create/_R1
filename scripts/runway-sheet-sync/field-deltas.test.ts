import { describe, expect, it } from "vitest";
import { categoryDelta, statusDelta, titleDelta, weekOfDelta } from "./field-deltas";

describe("statusDelta (§2.4 update policy)", () => {
  it("never overwrites protected human-set statuses", () => {
    expect(statusDelta("scheduled", "blocked")?.action).toBe(
      "protected-no-write"
    );
    expect(statusDelta("completed", "at-risk")?.action).toBe(
      "protected-no-write"
    );
    expect(statusDelta("completed", "in-progress")?.action).toBe(
      "protected-no-write"
    );
  });

  it("flags completed-revert instead of writing", () => {
    expect(statusDelta("scheduled", "completed")?.action).toBe(
      "flag-for-review"
    );
  });

  it("promotes scheduled → completed as the only safe write", () => {
    expect(statusDelta("completed", "scheduled")?.action).toBe("write");
    expect(statusDelta("completed", null)?.action).toBe("write"); // NULL ≡ scheduled during rollout
  });

  it("returns null when in agreement", () => {
    expect(statusDelta("scheduled", "scheduled")).toBeNull();
    expect(statusDelta("scheduled", null)).toBeNull();
  });
});


/**
 * _R1#160: full-field delta. weekOf and title join the correctable set;
 * category gains a flag-only policy. owner/resources come from the role
 * map, _R1#159, and are covered in role-map.test.ts.
 */
describe("weekOfDelta (§2.4-style update policy, _R1#160)", () => {
  it("writes when the sheet's weekOf differs from Runway's", () => {
    expect(weekOfDelta("2026-06-08", "2026-06-01")).toMatchObject({
      field: "weekOf",
      sheet: "2026-06-08",
      runway: "2026-06-01",
      action: "write",
    });
  });

  it("writes against a null Runway weekOf", () => {
    expect(weekOfDelta("2026-06-01", null)?.action).toBe("write");
  });

  it("returns null when in agreement, or the sheet carries no weekOf", () => {
    expect(weekOfDelta("2026-06-01", "2026-06-01")).toBeNull();
    expect(weekOfDelta(null, "2026-06-01")).toBeNull();
  });
});

describe("categoryDelta (_R1#160, TP ruling 2026-09-22: flag-only, never a write)", () => {
  it("flags a non-null Runway category, naming the value; never a write", () => {
    const d = categoryDelta("kickoff");
    expect(d).toMatchObject({
      field: "category",
      sheet: null,
      runway: "kickoff",
      action: "flag-for-review",
    });
  });

  it("returns null on a null Runway category, nothing to flag, nothing to write", () => {
    expect(categoryDelta(null)).toBeNull();
  });
});

describe("titleDelta (_R1#160, depends on #153 ledger identity)", () => {
  it("writes the correction when the match came from ledger identity", () => {
    const d = titleDelta("New Title", "Old Title", true);
    expect(d).toMatchObject({
      field: "title",
      sheet: "New Title",
      runway: "Old Title",
      action: "write",
    });
  });

  it("flags, never writes, when the match came from fuzzy title alone", () => {
    const d = titleDelta("New Title", "Old Title", false);
    expect(d).toMatchObject({ field: "title", action: "flag-for-review" });
  });

  it("returns null when titles agree modulo normalization", () => {
    expect(titleDelta("Kickoff Call", "kickoff  call", true)).toBeNull();
    expect(titleDelta("Kickoff Call", "kickoff  call", false)).toBeNull();
  });
});
