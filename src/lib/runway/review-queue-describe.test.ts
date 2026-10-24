import { describe, expect, it } from "vitest";
import { describeReviewPayload } from "./review-queue-describe";

describe("describeReviewPayload", () => {
  it("names a proposed Project create in plain words", () => {
    const d = describeReviewPayload({
      op: "addProject",
      params: { clientSlug: "acme", name: "Spring Launch", notes: "ACME-01", updatedBy: "sheet-sync" },
      reason: "no Runway L1 matched this engagement, no resolver fired",
    });
    expect(d.summary).toBe('Create Project "Spring Launch" for client acme');
    expect(d.reason).toBe("no Runway Project matched this engagement, no resolver fired");
    expect(d.fields).toEqual([
      { label: "clientSlug", value: "acme" },
      { label: "name", value: "Spring Launch" },
      { label: "notes", value: "ACME-01" },
    ]);
  });

  it("names a Task create under its Project", () => {
    const d = describeReviewPayload({
      op: "createWeekItem",
      params: { projectName: "Spring Launch", title: "Kickoff", weekOf: "2026-10-19", category: null },
      reason: "mid-week collision",
    });
    expect(d.summary).toBe('Create Task "Kickoff" under Project "Spring Launch"');
    expect(d.fields).toContainEqual({ label: "category", value: "empty" });
  });

  it("names a field change on a Task", () => {
    const d = describeReviewPayload({
      op: "updateWeekItemField",
      params: { weekOf: "2026-10-19", weekItemTitle: "Kickoff", field: "endDate", newValue: "2026-10-23" },
      reason: "field drift",
    });
    expect(d.summary).toBe('Change endDate on Task "Kickoff" to 2026-10-23');
  });

  it("names a flagged field and a flagged engagement match", () => {
    expect(
      describeReviewPayload({
        op: "flag-for-review",
        params: { weekItemId: "wi-1", field: "category", sheetValue: "delivery", runwayValue: "review" },
        reason: "x",
      }).summary,
    ).toBe('Check category on Task wi-1: Runway has "review", the sheet has "delivery"');
    expect(
      describeReviewPayload({
        op: "flag-for-review",
        params: { candidateWeekItemTitle: "Launch", candidateProjectName: "Retainer" },
        reason: "x",
      }).summary,
    ).toBe('Check whether this engagement is Task "Launch" under Project "Retainer"');
  });

  it("falls back to the raw op when it does not know it", () => {
    expect(describeReviewPayload({ op: "somethingNew", params: {}, reason: "" }).summary).toBe("somethingNew");
  });
});
