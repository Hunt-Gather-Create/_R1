/**
 * Turns a held sheet-sync payload into plain words for the review queue page.
 * End users read "Project" and "Task", never L1 or L2, per D-16.
 */

export interface ReviewPayloadLike {
  op: string;
  params: Record<string, unknown>;
  reason: string;
}

export interface ReviewPayloadDescription {
  summary: string;
  reason: string;
  fields: { label: string; value: string }[];
}

// The sync stamps its own name here; it is not a proposed value.
const HIDDEN_PARAMS = new Set(["updatedBy"]);

function str(v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function toEndUserWords(text: string): string {
  return text.replace(/\bL1s?\b/g, (m) => (m.endsWith("s") ? "Projects" : "Project")).replace(
    /\bL2s?\b/g,
    (m) => (m.endsWith("s") ? "Tasks" : "Task"),
  );
}

function summarize(op: string, p: Record<string, unknown>): string {
  switch (op) {
    case "addProject":
      return `Create Project "${str(p.name)}" for client ${str(p.clientSlug)}`;
    case "createWeekItem":
      return `Create Task "${str(p.title)}" under Project "${str(p.projectName)}"`;
    case "updateWeekItemField":
      return `Change ${str(p.field)} on Task "${str(p.weekItemTitle)}" to ${str(p.newValue)}`;
    case "flag-for-review":
      if (p.field !== undefined) {
        return `Check ${str(p.field)} on Task ${str(p.weekItemId)}: Runway has "${str(p.runwayValue)}", the sheet has "${str(p.sheetValue)}"`;
      }
      if (p.candidateWeekItemTitle !== undefined) {
        return `Check whether this engagement is Task "${str(p.candidateWeekItemTitle)}" under Project "${str(p.candidateProjectName)}"`;
      }
      return "Check this change by hand";
    default:
      return op;
  }
}

export function describeReviewPayload(payload: ReviewPayloadLike): ReviewPayloadDescription {
  const params = payload.params ?? {};
  return {
    summary: summarize(payload.op, params),
    reason: toEndUserWords(payload.reason ?? ""),
    fields: Object.entries(params)
      .filter(([k]) => !HIDDEN_PARAMS.has(k))
      .map(([label, v]) => ({ label, value: str(v) })),
  };
}
