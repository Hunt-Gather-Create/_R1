/**
 * Tests for `validateModalSubmission` — Wave 9 / Builder 9.
 *
 * Coverage:
 *   - Boundary normalization: empty-string date inputs become null.
 *   - Required-field check (create flow):
 *       - Project mode (is_retainer=false): name, status, category required.
 *       - Retainer mode (is_retainer=true): name, contractStart, contractEnd required.
 *       - Task: title, category, date, parent_project required.
 *       - Team Member: fullName, role_category required.
 *   - Reused Wave 0b validators (status/category, role-tag, date-order, notes max).
 *   - Modal-specific rules:
 *       - Parent-must-be-retainer (Project, non-retainer mode).
 *       - Lazy parent resolution for Task via pendingProjectName.
 *       - Wrapper-vs-child date-extension soft-warn.
 *       - Title-collision soft-warn (Sørensen-Dice >= 0.85 against same client/project).
 *   - Edit flow:
 *       - target-still-exists check.
 *       - changed-field diff: only changed fields validated.
 *       - no-changes detected (all values equal currentValues) -> error.
 *
 * Strategy: pass a tiny in-memory `db` mock that exposes
 * `select().from(...).where(...).limit(...)` chained the same way the route
 * tests do — `validateModalSubmission` only ever issues read SELECTs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Patch eq() to return our id-match sentinel so `where(eq(table.id, value))`
// works against the mock. Done at module-mock level so it sticks for all
// imports of drizzle-orm in this test file.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return {
    ...actual,
    eq: (col: unknown, value: unknown) => ({ _idMatch: value, _col: col }),
  };
});

import { getTableName } from "drizzle-orm";
import {
  validateModalSubmission,
  type ValidateModalSubmissionParams,
} from "./validate-submission";

// ────────────────────────────────────────────────────────────────────────────
// Db mock — same shape as route.test.ts: chainable select with by-table-name
// dispatch + by-id where filter.
// ────────────────────────────────────────────────────────────────────────────

type MockDb = ReturnType<typeof makeDb>;

interface MockState {
  projects: Array<Record<string, unknown>>;
  weekItems: Array<Record<string, unknown>>;
  teamMembers: Array<Record<string, unknown>>;
}

function makeDb(state: MockState) {
  const tableRows = (t: unknown): Array<Record<string, unknown>> => {
    let name = "";
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      name = getTableName(t as any);
    } catch {
      name = "";
    }
    if (name === "projects") return state.projects;
    if (name === "week_items") return state.weekItems;
    if (name === "team_members") return state.teamMembers;
    return [];
  };

  let selectedTable: unknown = null;
  let whereFilter: ((row: Record<string, unknown>) => boolean) | null = null;

  const buildChain = () => {
    const exec = () => {
      const rows = tableRows(selectedTable);
      if (!whereFilter) return rows;
      return rows.filter(whereFilter);
    };
    const chain = {
      from(t: unknown) {
        selectedTable = t;
        whereFilter = null;
        return chain;
      },
      where(filter: { _idMatch?: string }) {
        if (filter._idMatch !== undefined) {
          const id = filter._idMatch;
          whereFilter = (r) => r.id === id;
        }
        return chain;
      },
      limit() {
        return Promise.resolve(exec());
      },
      then<R>(resolve: (rows: Array<Record<string, unknown>>) => R) {
        return Promise.resolve(exec()).then(resolve);
      },
    };
    return chain;
  };

  return {
    select: () => buildChain(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers — build a minimal proposal row + state.values shape for tests.
// ────────────────────────────────────────────────────────────────────────────

interface ProposalLike {
  id: string;
  toolName: string;
  kind: "create" | "edit";
  args: string;
  targetEntityId: string | null;
  targetEntityType: string | null;
  pendingProjectName: string | null;
  resolvedProjectId: string | null;
  status: string;
}

function makeProposal(over: Partial<ProposalLike> = {}): ProposalLike {
  return {
    id: "prop_test_001",
    toolName: "create_week_item",
    kind: "create",
    args: JSON.stringify({}),
    targetEntityId: null,
    targetEntityType: null,
    pendingProjectName: null,
    resolvedProjectId: null,
    status: "pending",
    ...over,
  };
}

// state.values shape: block_id -> action_id -> element-shape
type StateValues = Record<string, Record<string, unknown>>;

function plainTextV(value: string) {
  return { type: "plain_text_input", value };
}
function selectV(value: string) {
  return {
    type: "static_select",
    selected_option: { value, text: { type: "plain_text", text: value } },
  };
}
function externalSelectV(value: string) {
  return {
    type: "external_select",
    selected_option: { value, text: { type: "plain_text", text: value } },
  };
}
function radioV(value: string) {
  return {
    type: "radio_buttons",
    selected_option: { value, text: { type: "plain_text", text: value } },
  };
}
function dateV(date: string) {
  return { type: "datepicker", selected_date: date };
}
function checkboxV(values: string[]) {
  return {
    type: "checkboxes",
    selected_options: values.map((value) => ({
      value,
      text: { type: "plain_text", text: value },
    })),
  };
}

// Future-proof default-state factories
function taskState(over: Partial<Record<string, Record<string, unknown>>> = {}): StateValues {
  return {
    client_block: { client_select: externalSelectV("client_xyz") },
    parent_project_block: {
      parent_project_select: externalSelectV("proj_parent_id_xyz_long_id"),
    },
    title_block: { title_input: plainTextV("Concept Writeup") },
    category_block: { category_select: selectV("delivery") },
    date_type_block: { date_type_radio: radioV("single") },
    date_block: { date_picker: dateV("2026-05-04") },
    owner_block: { owner_select: externalSelectV("CW: Kathy") },
    resources_block_0: { resources_role_0: selectV("CW") },
    resources_name_block_0: { resources_name_0: selectV("Kathy") },
    notes_block: { notes_input: plainTextV("") },
    ...over,
  };
}

function projectState(
  retainerMode = false,
  over: Partial<Record<string, Record<string, unknown>>> = {},
): StateValues {
  const base: StateValues = {
    client_block: { client_select: externalSelectV("client_xyz") },
    is_retainer_block: {
      is_retainer_checkbox: checkboxV(retainerMode ? ["is_retainer"] : []),
    },
    project_name_block: { project_name_input: plainTextV("Spring Refresh") },
    engagement_type_block: { engagement_type_radio: radioV("project") },
    status_block: { status_select: selectV("not-started") },
    category_block: { category_select: selectV("active") },
    owner_block: { owner_select: externalSelectV("AM: Allison") },
    resources_block_0: { resources_role_0: selectV("AM") },
    resources_name_block_0: { resources_name_0: selectV("Allison") },
    start_date_block: { start_date_picker: dateV("2026-05-01") },
    end_date_block: { end_date_picker: dateV("2026-06-15") },
    due_date_block: { due_date_picker: dateV("") },
    notes_block: { notes_input: plainTextV("") },
  };
  if (retainerMode) {
    base.contract_start_block = { contract_start_picker: dateV("2026-01-01") };
    base.contract_end_block = { contract_end_picker: dateV("2026-12-31") };
  }
  return { ...base, ...over };
}

function teamMemberState(over: Partial<Record<string, Record<string, unknown>>> = {}): StateValues {
  return {
    client_block: { client_select: selectV("client_xyz") },
    name_block: { name_input: plainTextV("Sam Rivera") },
    role_category_block: { role_category_select: selectV("creative") },
    email_block: { email_input: plainTextV("sam@example.test") },
    ...over,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("validateModalSubmission - boundary normalization", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = { projects: [], weekItems: [], teamMembers: [] };
    db = makeDb(state);
  });

  it("normalizes empty-string date inputs to null on the normalized output", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      date_block: { date_picker: { type: "datepicker", selected_date: "" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    // Empty-date should be normalized to null - missing required field for task =>
    // returns { ok: false, errors }.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveProperty("date_block");
    }
  });

  it("normalizes notes empty-string to null without tripping maxLength", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      notes_block: { notes_input: { type: "plain_text_input", value: "" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
  });
});

describe("validateModalSubmission - required-field check (create flow)", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = { projects: [], weekItems: [], teamMembers: [] };
    db = makeDb(state);
  });

  it("Task: missing title returns errors[title_block]", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      title_block: { title_input: plainTextV("") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.title_block).toBeDefined();
    }
  });

  it("Task: missing category returns errors[category_block]", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      category_block: { category_select: { type: "static_select" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.category_block).toBeDefined();
    }
  });

  it("Task: missing parent_project_block returns errors", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      parent_project_block: { parent_project_select: { type: "external_select" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.parent_project_block).toBeDefined();
    }
  });

  it("Project (project mode): missing status returns errors[status_block]", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false, {
      status_block: { status_select: { type: "static_select" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.status_block).toBeDefined();
    }
  });

  it("Project (project mode): missing project_name returns errors[project_name_block]", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false, {
      project_name_block: { project_name_input: plainTextV("") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.project_name_block).toBeDefined();
    }
  });

  it("Project (retainer mode): missing contractStart returns errors[contract_start_block]", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(true, {
      contract_start_block: { contract_start_picker: { type: "datepicker" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.contract_start_block).toBeDefined();
    }
  });

  it("Project (retainer mode): missing contractEnd returns errors[contract_end_block]", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(true, {
      contract_end_block: { contract_end_picker: { type: "datepicker" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.contract_end_block).toBeDefined();
    }
  });

  it("Team Member: missing fullName returns errors[name_block]", async () => {
    const proposal = makeProposal({ toolName: "create_team_member" });
    const stateValues = teamMemberState({
      name_block: { name_input: plainTextV("") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name_block).toBeDefined();
    }
  });

  it("Team Member: missing roleCategory returns errors[role_category_block]", async () => {
    const proposal = makeProposal({ toolName: "create_team_member" });
    const stateValues = teamMemberState({
      role_category_block: { role_category_select: { type: "static_select" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.role_category_block).toBeDefined();
    }
  });

  it("Project happy path returns ok=true", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false);
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
  });

  it("Task happy path returns ok=true", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState();
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
  });

  it("Team Member happy path returns ok=true", async () => {
    const proposal = makeProposal({ toolName: "create_team_member" });
    const stateValues = teamMemberState();
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
  });
});

describe("validateModalSubmission - date_type radio mode (Issue 3)", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = { projects: [], weekItems: [], teamMembers: [] };
    db = makeDb(state);
  });

  it("Single mode: mirrors picked date to BOTH startDate AND endDate (data integrity)", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      date_type_block: { date_type_radio: radioV("single") },
      date_block: { date_picker: dateV("2026-05-08") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.date).toBe("2026-05-08");
      expect(result.normalized.startDate).toBe("2026-05-08");
      expect(result.normalized.endDate).toBe("2026-05-08");
    }
  });

  it("Range mode: keeps separate startDate/endDate from the two pickers", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      date_type_block: { date_type_radio: radioV("range") },
      // date_block intentionally absent — Range mode doesn't render it
      start_date_block: { start_date_picker: dateV("2026-05-04") },
      end_date_block: { end_date_picker: dateV("2026-05-09") },
    });
    delete stateValues.date_block;
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.startDate).toBe("2026-05-04");
      expect(result.normalized.endDate).toBe("2026-05-09");
    }
  });

  it("Range mode: missing startDate fires errors[start_date_block]", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      date_type_block: { date_type_radio: radioV("range") },
      start_date_block: { start_date_picker: { type: "datepicker" } },
      end_date_block: { end_date_picker: dateV("2026-05-09") },
    });
    delete stateValues.date_block;
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.start_date_block).toBeDefined();
    }
  });

  it("Range mode: missing endDate fires errors[end_date_block]", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      date_type_block: { date_type_radio: radioV("range") },
      start_date_block: { start_date_picker: dateV("2026-05-04") },
      end_date_block: { end_date_picker: { type: "datepicker" } },
    });
    delete stateValues.date_block;
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.end_date_block).toBeDefined();
    }
  });

  it("Range mode: start > end fires the existing order validator", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      date_type_block: { date_type_radio: radioV("range") },
      start_date_block: { start_date_picker: dateV("2026-05-15") },
      end_date_block: { end_date_picker: dateV("2026-05-04") },
    });
    delete stateValues.date_block;
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.start_date_block).toBeDefined();
    }
  });

  it("Single mode: missing date fires errors[date_block]", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      date_type_block: { date_type_radio: radioV("single") },
      date_block: { date_picker: { type: "datepicker" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.date_block).toBeDefined();
    }
  });

  // Slack quirk: after a date_type_radio toggle that rebuilt the view via
  // views.update, state.values may NOT include selected_option for the
  // radio if the user did not re-click it in the new rendering. The
  // extractor infers dateType from which date fields are populated so a
  // fully-filled range submission does not get falsely rejected with
  // "date_block: Date is required". (Live-fire bug 2026-05-04.)
  it("Range mode: infers dateType=range when state.values has no date_type_block (radio not re-clicked after rebuild)", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      start_date_block: { start_date_picker: dateV("2026-05-04") },
      end_date_block: { end_date_picker: dateV("2026-05-09") },
    });
    // Simulate the Slack quirk: the radio's selected_option is missing
    // from state.values entirely.
    delete stateValues.date_type_block;
    delete stateValues.date_block;
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.startDate).toBe("2026-05-04");
      expect(result.normalized.endDate).toBe("2026-05-09");
    }
  });

  it("Range mode: missing date_type_block + missing endDate still reports end_date_block error (not date_block)", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      start_date_block: { start_date_picker: dateV("2026-05-04") },
      end_date_block: { end_date_picker: { type: "datepicker" } },
    });
    delete stateValues.date_type_block;
    delete stateValues.date_block;
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.end_date_block).toBeDefined();
      expect(result.errors.date_block).toBeUndefined();
    }
  });

  it("Single mode: infers dateType=single when state.values has no date_type_block but date is populated", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      date_block: { date_picker: dateV("2026-05-08") },
    });
    delete stateValues.date_type_block;
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Single mode mirrors date to both startDate and endDate
      expect(result.normalized.date).toBe("2026-05-08");
      expect(result.normalized.startDate).toBe("2026-05-08");
      expect(result.normalized.endDate).toBe("2026-05-08");
    }
  });

  // Live-fire bug 2026-05-04 round 2: Slack returned the STALE "single"
  // initial_option in state.values even after the user toggled to Range,
  // filled in start+end, and submitted. The radio reading conflicted with
  // the actual filled fields. Trust the date fields - they're the
  // authoritative signal.
  it("Range mode: overrides stale 'single' radio reading when start+end are populated", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      // Slack's stale state: radio still says single because the rebuild's
      // initial_option = range was never user-clicked in the new rendering.
      date_type_block: { date_type_radio: radioV("single") },
      // But the user filled in start + end - they ARE in range mode.
      start_date_block: { start_date_picker: dateV("2026-05-05") },
      end_date_block: { end_date_picker: dateV("2026-05-06") },
    });
    delete stateValues.date_block;
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.startDate).toBe("2026-05-05");
      expect(result.normalized.endDate).toBe("2026-05-06");
    }
  });

  it("Single mode: overrides stale 'range' radio reading when only date is populated", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      // Mirror image: stale 'range' from a prior toggle, but user ended on
      // single mode and only filled in `date`.
      date_type_block: { date_type_radio: radioV("range") },
      date_block: { date_picker: dateV("2026-05-08") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.date).toBe("2026-05-08");
      expect(result.normalized.startDate).toBe("2026-05-08");
      expect(result.normalized.endDate).toBe("2026-05-08");
    }
  });
});

describe("validateModalSubmission - Wave 0b validator integration", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = { projects: [], weekItems: [], teamMembers: [] };
    db = makeDb(state);
  });

  it("Project: status=completed + category=active is rejected (status/category matrix)", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false, {
      status_block: { status_select: selectV("completed") },
      category_block: { category_select: selectV("active") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Slack errors keyed by block_id; status/category block are both candidates,
      // we route to status_block.
      expect(result.errors.status_block ?? result.errors.category_block).toBeDefined();
    }
  });

  it("Project: blocked + active is a soft-warn (not a hard reject)", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false, {
      status_block: { status_select: selectV("blocked") },
      category_block: { category_select: selectV("active") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    // Soft warn -> not blocking but surfaced
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.softWarnings ?? []).toContainEqual(
        expect.stringContaining("blocked"),
      );
    }
  });

  it("Project: untagged resources entry rejects (role-tag validator)", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    // Replace resources block to simulate a bare entry that would trip role-tag.
    const stateValues = projectState(false, {
      resources_block_0: { resources_role_0: { type: "static_select" } }, // no role
      resources_name_block_0: { resources_name_0: selectV("Allison") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.resources_block_0 ?? result.errors.resources_name_block_0,
      ).toBeDefined();
    }
  });

  it("Project: startDate >= endDate rejects (date-order validator)", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false, {
      start_date_block: { start_date_picker: dateV("2026-06-15") },
      end_date_block: { end_date_picker: dateV("2026-05-01") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.start_date_block ?? result.errors.end_date_block,
      ).toBeDefined();
    }
  });

  it("Retainer: contractStart >= contractEnd rejects (contract-order)", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(true, {
      contract_start_block: { contract_start_picker: dateV("2026-12-31") },
      contract_end_block: { contract_end_picker: dateV("2026-01-01") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.contract_start_block ?? result.errors.contract_end_block,
      ).toBeDefined();
    }
  });

  it("Project: notes longer than 500 chars rejects (notes max L1)", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const longNotes = "a".repeat(501);
    const stateValues = projectState(false, {
      notes_block: { notes_input: plainTextV(longNotes) },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.notes_block).toBeDefined();
    }
  });

  it("Task: notes longer than 280 chars rejects (notes max L2)", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const longNotes = "a".repeat(281);
    const stateValues = taskState({
      notes_block: { notes_input: plainTextV(longNotes) },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.notes_block).toBeDefined();
    }
  });

  it("Past-date + non-terminal status surfaces a soft-warn (not a hard reject)", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    // Date well in the past, status non-terminal (we'll pass status="scheduled"
    // implicitly via the route layer; for tasks, a past date triggers the soft-warn).
    const stateValues = taskState({
      date_block: { date_picker: dateV("2020-01-01") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.softWarnings ?? []).some((w) => /past/i.test(w)),
      ).toBe(true);
    }
  });
});

describe("validateModalSubmission - parent-must-be-retainer", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = {
      projects: [
        // A retainer wrapper - valid parent.
        {
          id: "proj_retainer_xyz",
          name: "AG1 Retainer",
          clientId: "client_xyz",
          engagementType: "retainer",
        },
        // A non-retainer - invalid parent.
        {
          id: "proj_normal_xyz",
          name: "AG1 Build",
          clientId: "client_xyz",
          engagementType: "project",
        },
      ],
      weekItems: [],
      teamMembers: [],
    };
    db = makeDb(state);
  });

  it("Project (non-retainer mode): parent that is itself a retainer is allowed", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false, {
      parent_retainer_block: {
        parent_retainer_picker: externalSelectV("proj_retainer_xyz"),
      },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
  });

  it("Project (non-retainer mode): parent that is NOT a retainer is rejected", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false, {
      parent_retainer_block: {
        parent_retainer_picker: externalSelectV("proj_normal_xyz"),
      },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.parent_retainer_block).toBeDefined();
    }
  });

  it("Project (non-retainer mode): parent picker empty is fine (no parent)", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false);
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
  });
});

describe("validateModalSubmission - lazy parent resolution (Task)", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = {
      projects: [
        {
          id: "proj_brand_refresh",
          name: "Brand Refresh",
          clientId: "client_xyz",
          engagementType: "project",
        },
        {
          id: "proj_brand_strategy",
          name: "Brand Strategy",
          clientId: "client_xyz",
          engagementType: "project",
        },
      ],
      weekItems: [],
      teamMembers: [],
    };
    db = makeDb(state);
  });

  it("resolved_project_id pre-set: uses it directly even if pendingProjectName is set", async () => {
    const proposal = makeProposal({
      toolName: "create_week_item",
      pendingProjectName: "Brand Refresh",
      resolvedProjectId: "proj_brand_refresh",
    });
    const stateValues = taskState({
      // Empty parent picker, but resolvedProjectId is already on the proposal.
      parent_project_block: { parent_project_select: { type: "external_select" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    // Note: even though parent_project_block is empty, the resolvedProjectId
    // satisfies the parent requirement.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.parent_project_id ?? result.normalized.parentProjectId).toBe(
        "proj_brand_refresh",
      );
    }
  });

  it("pendingProjectName resolves via fuzzy match: single match -> sets parentProjectId", async () => {
    const proposal = makeProposal({
      toolName: "create_week_item",
      pendingProjectName: "Brand Refresh",
    });
    const stateValues = taskState({
      parent_project_block: { parent_project_select: { type: "external_select" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.parent_project_id ?? result.normalized.parentProjectId).toBe(
        "proj_brand_refresh",
      );
    }
  });

  it("pendingProjectName resolves: no match -> error PARENT_PROJECT_NOT_FOUND", async () => {
    const proposal = makeProposal({
      toolName: "create_week_item",
      pendingProjectName: "Nonexistent Project zzz",
    });
    const stateValues = taskState({
      parent_project_block: { parent_project_select: { type: "external_select" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.parent_project_block).toMatch(/Parent project not found/i);
    }
  });

  it("pendingProjectName resolves: multi-match -> ambiguous error", async () => {
    const proposal = makeProposal({
      toolName: "create_week_item",
      pendingProjectName: "Brand",
    });
    const stateValues = taskState({
      parent_project_block: { parent_project_select: { type: "external_select" } },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.parent_project_block).toBeDefined();
    }
  });
});

describe("validateModalSubmission - title-collision soft-warn", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = {
      projects: [
        // Existing project that "Spring Refresh" will fuzz against.
        {
          id: "proj_spring_refresh",
          name: "Spring Refresh",
          clientId: "client_xyz",
          engagementType: "project",
        },
      ],
      weekItems: [
        {
          id: "wi_existing_concept",
          title: "Concept Writeup",
          projectId: "proj_parent_id_xyz_long_id",
          clientId: "client_xyz",
        },
      ],
      teamMembers: [
        {
          id: "tm_existing_sam",
          fullName: "Sam Rivera",
          name: "Sam",
        },
      ],
    };
    db = makeDb(state);
  });

  it("Project: a new project name nearly identical to an existing project soft-warns", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false, {
      project_name_block: { project_name_input: plainTextV("Spring Refresh") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.softWarnings ?? []).some((w) => /Spring Refresh/.test(w)),
      ).toBe(true);
    }
  });

  it("Task: a new title nearly identical to an existing one in the same project soft-warns", async () => {
    const proposal = makeProposal({ toolName: "create_week_item" });
    const stateValues = taskState({
      title_block: { title_input: plainTextV("Concept Writeup") },
      parent_project_block: {
        parent_project_select: externalSelectV("proj_parent_id_xyz_long_id"),
      },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.softWarnings ?? []).some((w) => /Concept Writeup/.test(w)),
      ).toBe(true);
    }
  });

  it("Team Member: a new fullName nearly identical to an existing member soft-warns", async () => {
    const proposal = makeProposal({ toolName: "create_team_member" });
    const stateValues = teamMemberState({
      name_block: { name_input: plainTextV("Sam Rivera") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.softWarnings ?? []).some((w) => /Sam Rivera/.test(w)),
      ).toBe(true);
    }
  });

  it("No collision: distinct title doesn't soft-warn", async () => {
    const proposal = makeProposal({ toolName: "create_project" });
    const stateValues = projectState(false, {
      project_name_block: { project_name_input: plainTextV("Q1 Newsletter Campaign") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.softWarnings ?? []).some((w) => /Q1 Newsletter/.test(w)),
      ).toBe(false);
    }
  });
});

describe("validateModalSubmission - wrapper-vs-child date-extension soft-warn", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = {
      projects: [
        {
          id: "proj_retainer_2026",
          name: "AG1 Retainer 2026",
          clientId: "client_xyz",
          engagementType: "retainer",
          contractStart: "2026-01-01",
          contractEnd: "2026-12-31",
        },
        // Edit target — child of the retainer wrapper above.
        {
          id: "proj_child_xyz",
          name: "AG1 Build",
          clientId: "client_xyz",
          engagementType: "project",
          parentProjectId: "proj_retainer_2026",
          startDate: "2026-03-01",
          endDate: "2026-05-01",
          status: "in-production",
          category: "active",
          notes: null,
          owner: "AM: Allison",
          resources: "AM: Allison",
        },
      ],
      weekItems: [],
      teamMembers: [],
    };
    db = makeDb(state);
  });

  it("Project edit: child date pushed beyond wrapper's contractEnd soft-warns", async () => {
    const proposal = makeProposal({
      toolName: "update_project",
      kind: "edit",
      targetEntityId: "proj_child_xyz",
      targetEntityType: "project",
      args: JSON.stringify({}),
    });
    const stateValues = projectState(false, {
      project_name_block: { project_name_input: plainTextV("AG1 Build") },
      status_block: { status_select: selectV("in-production") },
      category_block: { category_select: selectV("active") },
      // endDate pushed past wrapper.contractEnd 2026-12-31.
      start_date_block: { start_date_picker: dateV("2026-03-01") },
      end_date_block: { end_date_picker: dateV("2027-02-01") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.softWarnings ?? []).some((w) =>
          /wrapper|contract|exceeds/i.test(w),
        ),
      ).toBe(true);
    }
  });
});

describe("validateModalSubmission - edit flow", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = {
      projects: [
        {
          id: "proj_target_xyz",
          name: "AG1 Build",
          clientId: "client_xyz",
          engagementType: "project",
          status: "in-production",
          category: "active",
          startDate: "2026-03-01",
          endDate: "2026-05-01",
          owner: "AM: Allison",
          resources: "AM: Allison",
          notes: null,
          parentProjectId: null,
        },
      ],
      weekItems: [],
      teamMembers: [],
    };
    db = makeDb(state);
  });

  it("target-still-exists check: target_entity_id missing in DB returns error", async () => {
    const proposal = makeProposal({
      toolName: "update_project",
      kind: "edit",
      targetEntityId: "proj_does_not_exist",
      targetEntityType: "project",
      args: JSON.stringify({}),
    });
    const stateValues = projectState(false);
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Single error keyed to a banner block.
      const messages = Object.values(result.errors);
      expect(messages.some((m) => /no longer exists|deleted|not found/i.test(m))).toBe(
        true,
      );
    }
  });

  it("changed-field diff: only changed fields are validated, unchanged values pass through", async () => {
    const proposal = makeProposal({
      toolName: "update_project",
      kind: "edit",
      targetEntityId: "proj_target_xyz",
      targetEntityType: "project",
      args: JSON.stringify({}),
    });
    // Submit only changes status. The rest match currentValues from DB row.
    const stateValues = projectState(false, {
      project_name_block: { project_name_input: plainTextV("AG1 Build") },
      status_block: { status_select: selectV("completed") },
      category_block: { category_select: selectV("completed") },
      start_date_block: { start_date_picker: dateV("2026-03-01") },
      end_date_block: { end_date_picker: dateV("2026-05-01") },
      owner_block: { owner_select: externalSelectV("AM: Allison") },
      resources_block_0: { resources_role_0: selectV("AM") },
      resources_name_block_0: { resources_name_0: selectV("Allison") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changedFields).toBeDefined();
      // status and category changed (in-production -> completed, active -> completed).
      expect(result.changedFields).toContain("status");
      expect(result.changedFields).toContain("category");
      // name didn't change.
      expect(result.changedFields).not.toContain("name");
    }
  });

  it("changed-field diff: empty diff (no fields differ) returns error", async () => {
    const proposal = makeProposal({
      toolName: "update_project",
      kind: "edit",
      targetEntityId: "proj_target_xyz",
      targetEntityType: "project",
      args: JSON.stringify({}),
    });
    // Exact echo of current values.
    const stateValues = projectState(false, {
      project_name_block: { project_name_input: plainTextV("AG1 Build") },
      status_block: { status_select: selectV("in-production") },
      category_block: { category_select: selectV("active") },
      start_date_block: { start_date_picker: dateV("2026-03-01") },
      end_date_block: { end_date_picker: dateV("2026-05-01") },
      owner_block: { owner_select: externalSelectV("AM: Allison") },
      resources_block_0: { resources_role_0: selectV("AM") },
      resources_name_block_0: { resources_name_0: selectV("Allison") },
      // Engagement type same as current
      engagement_type_block: { engagement_type_radio: radioV("project") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = Object.values(result.errors);
      expect(messages.some((m) => /no changes/i.test(m))).toBe(true);
    }
  });

  it("changed-field diff: a single legitimate field change passes (validated only that field)", async () => {
    const proposal = makeProposal({
      toolName: "update_project",
      kind: "edit",
      targetEntityId: "proj_target_xyz",
      targetEntityType: "project",
      args: JSON.stringify({}),
    });
    const stateValues = projectState(false, {
      project_name_block: { project_name_input: plainTextV("AG1 Build Renamed") },
      status_block: { status_select: selectV("in-production") },
      category_block: { category_select: selectV("active") },
      start_date_block: { start_date_picker: dateV("2026-03-01") },
      end_date_block: { end_date_picker: dateV("2026-05-01") },
      owner_block: { owner_select: externalSelectV("AM: Allison") },
      resources_block_0: { resources_role_0: selectV("AM") },
      resources_name_block_0: { resources_name_0: selectV("Allison") },
    });
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changedFields).toEqual(["name"]);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Edit-flow args-fallback tests — guard against the multi-match candidate
// picker save bug where Slack omits untouched plain_text_input /
// external_select blocks from view.state.values, causing canonical[field] to
// be null and computeChangedFields to flag a spurious "change to null".
// ────────────────────────────────────────────────────────────────────────────

describe("validateModalSubmission - edit flow args-fallback", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = {
      projects: [
        {
          id: "proj_p1",
          name: "Existing Project",
          clientId: "client_xyz",
          engagementType: "project",
          status: "in-production",
          category: "active",
          startDate: "2026-03-01",
          endDate: "2026-05-01",
          owner: "AM: Allison",
          resources: "AM: Allison",
          notes: "existing notes",
          parentProjectId: null,
        },
      ],
      weekItems: [
        {
          id: "wi_target_xyz",
          title: "TEST Single Verify",
          clientId: "client_xyz",
          projectId: "proj_p1",
          category: "delivery",
          date: "2026-05-04",
          startDate: "2026-05-04",
          endDate: "2026-05-04",
          owner: "Jason Burks",
          resources: "AM: Lane Jordan",
          notes: "Single fix verify",
        },
      ],
      teamMembers: [],
    };
    db = makeDb(state);
  });

  it("Task edit: only date_type changed in state.values, untouched title/owner/notes are preserved from args (not flagged as null change)", async () => {
    // Reproduces the bug from the report: user picked TEST Single Verify
    // from the multi-match picker (args got enriched with row data), then
    // toggled Single -> Range, then hit Save. Slack's view.state.values
    // omits the untouched title/owner/notes blocks. Without the fallback,
    // canonical.title=null and computeChangedFields would flag "title" as
    // a change-to-null, causing the consumer to UPDATE title=NULL.
    const proposal = makeProposal({
      toolName: "update_week_item",
      kind: "edit",
      targetEntityId: "wi_target_xyz",
      targetEntityType: "week_item",
      // args carries the full enriched prefill from
      // handleMultiMatchCandidateSelect.
      args: JSON.stringify({
        title: "TEST Single Verify",
        clientId: "client_xyz",
        projectId: "proj_p1",
        category: "delivery",
        date: "2026-05-04",
        startDate: "2026-05-04",
        endDate: "2026-05-04",
        owner: "Jason Burks",
        // Resources lands as a string[] in args (post-multi-match-pick).
        resources: ["AM: Lane Jordan"],
        notes: "Single fix verify",
      }),
    });
    // state.values: only the toggled-to Range date pickers + parent project
    // (untouched but Slack happens to echo this external_select). The
    // title/owner/notes/category blocks are absent because the user never
    // touched them after the prefill.
    const stateValues: StateValues = {
      parent_project_block: {
        parent_project_select: externalSelectV("proj_p1"),
      },
      client_block: { client_select: externalSelectV("client_xyz") },
      // Range-mode date pickers (the user's only change).
      start_date_block: { start_date_picker: dateV("2026-05-04") },
      end_date_block: { end_date_picker: dateV("2026-05-08") },
      // Date type radio missing (Slack inconsistency); validator infers
      // dateType from filled date fields.
    };
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The bug was that "title" got flagged as changed-to-null. The fix:
      // args fallback restores canonical.title from args.
      expect(result.changedFields).toBeDefined();
      expect(result.changedFields).not.toContain("title");
      expect(result.changedFields).not.toContain("owner");
      expect(result.changedFields).not.toContain("notes");
      expect(result.changedFields).not.toContain("category");
      // The legitimate change: endDate moved to 2026-05-08.
      expect(result.changedFields).toContain("endDate");
      // Normalized output should reflect the prefilled title (not null).
      expect(result.normalized.title).toBe("TEST Single Verify");
      expect(result.normalized.owner).toBe("Jason Burks");
      expect(result.normalized.notes).toBe("Single fix verify");
    }
  });

  it("Task edit: explicit clear of a prefilled field is masked by args fallback (preserve over clear trade-off)", async () => {
    // Boundary case from the bug report. We cannot reliably distinguish
    // "user emptied the field" from "Slack omitted the block". We side
    // with "preserve" - the safer mode given the bug's blast radius
    // (NULL'ing untouched columns). The user can still re-clear by
    // editing again with a tiny non-empty value (e.g. a single space) or
    // by using the underlying API.
    const proposal = makeProposal({
      toolName: "update_week_item",
      kind: "edit",
      targetEntityId: "wi_target_xyz",
      targetEntityType: "week_item",
      args: JSON.stringify({
        title: "TEST Single Verify",
        clientId: "client_xyz",
        projectId: "proj_p1",
        category: "delivery",
        date: "2026-05-04",
        startDate: "2026-05-04",
        endDate: "2026-05-04",
        owner: "Jason Burks",
        resources: ["AM: Lane Jordan"],
        notes: "Single fix verify",
      }),
    });
    // User explicitly clears notes (sends empty string); other fields
    // touched too so we have a non-trivial diff.
    const stateValues: StateValues = {
      client_block: { client_select: externalSelectV("client_xyz") },
      parent_project_block: {
        parent_project_select: externalSelectV("proj_p1"),
      },
      title_block: { title_input: plainTextV("TEST Single Verify Renamed") },
      category_block: { category_select: selectV("delivery") },
      date_block: { date_picker: dateV("2026-05-04") },
      owner_block: { owner_select: externalSelectV("Jason Burks") },
      resources_block_0: { resources_role_0: selectV("AM") },
      resources_name_block_0: { resources_name_0: selectV("Lane Jordan") },
      notes_block: { notes_input: plainTextV("") }, // explicit clear
    };
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changedFields).toBeDefined();
      // Trade-off documented: explicit clear of notes is preserved by
      // args fallback, so it is NOT in changedFields. The legitimate
      // title rename IS in changedFields.
      expect(result.changedFields).toContain("title");
      // We err on the side of preserve: the explicit notes clear is
      // masked by args fallback. This is the documented trade-off.
      expect(result.changedFields).not.toContain("notes");
      expect(result.normalized.notes).toBe("Single fix verify");
    }
  });

  it("Task edit: args has no fallback for a field, state.values null -> canonical stays null, no spurious change flagged", async () => {
    // Args is empty (older proposal that never went through multi-match
    // enrichment, e.g. a single-match path that didn't persist row data).
    // State.values omits the title block. Target row title is "TEST
    // Single Verify". computeChangedFields will see canonical.title=null
    // vs target.title="TEST Single Verify" and flag it as a change. We
    // only assert that the validator does NOT crash and returns a
    // sensible result; this is the unfixable case where the caller has
    // to ensure args carries the prefill.
    const proposal = makeProposal({
      toolName: "update_week_item",
      kind: "edit",
      targetEntityId: "wi_target_xyz",
      targetEntityType: "week_item",
      args: JSON.stringify({}), // empty args - no fallback available
    });
    const stateValues: StateValues = {
      client_block: { client_select: externalSelectV("client_xyz") },
      parent_project_block: {
        parent_project_select: externalSelectV("proj_p1"),
      },
      // Title still prefilled as initial_value but echoed back by Slack
      // (the well-behaved case). category, owner, notes still echoed.
      title_block: { title_input: plainTextV("TEST Single Verify") },
      category_block: { category_select: selectV("delivery") },
      date_block: { date_picker: dateV("2026-05-08") }, // changed
      owner_block: { owner_select: externalSelectV("Jason Burks") },
      resources_block_0: { resources_role_0: selectV("AM") },
      resources_name_block_0: { resources_name_0: selectV("Lane Jordan") },
      notes_block: { notes_input: plainTextV("Single fix verify") },
    };
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Slack echoed the prefilled blocks, so title/owner/notes match
      // target and aren't flagged. The date change is the only diff.
      expect(result.changedFields).toBeDefined();
      expect(result.changedFields).not.toContain("title");
      expect(result.changedFields).not.toContain("owner");
      expect(result.changedFields).not.toContain("notes");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Edit-flow dateType-toggle tests — guard against the args-fallback over-
// aggression bug where toggling Single->Range (or Range->Single) mid-edit
// silently restored stale dates from the prior mode's mirroring, producing
// a startDate > endDate write-time rejection. The fix: when args.dateType
// disagrees with submitted dateType, the date trio is skipped from the
// fallback and the new mode's required fields must be supplied explicitly.
// ────────────────────────────────────────────────────────────────────────────

describe("validateModalSubmission - edit flow dateType toggle", () => {
  let state: MockState;
  let db: MockDb;
  beforeEach(() => {
    state = {
      projects: [
        {
          id: "proj_p1",
          name: "Existing Project",
          clientId: "client_xyz",
          engagementType: "project",
          status: "in-production",
          category: "active",
          parentProjectId: null,
        },
      ],
      weekItems: [
        {
          id: "wi_target_xyz",
          title: "TEST Single Verify",
          clientId: "client_xyz",
          projectId: "proj_p1",
          category: "delivery",
          date: "2026-05-06",
          startDate: "2026-05-06",
          endDate: "2026-05-06",
          owner: "Jason Burks",
          resources: "AM: Lane Jordan",
          notes: "Single fix verify",
        },
      ],
      teamMembers: [],
    };
    db = makeDb(state);
  });

  it("Single -> Range toggle, only startDate touched: rejects with 'End date is required' (no stale args.endDate fallback)", async () => {
    // Repro: opens Single-mode row whose date == startDate == endDate ==
    // 2026-05-06, toggles to Range, picks startDate=2026-05-07, hits Save
    // without picking endDate. Pre-fix: args.endDate=2026-05-06 fell back
    // into canonical, validator passed (one side null), consumer wrote
    // start=2026-05-07/end=2026-05-06 and writeUpdateWeekItem rejected
    // 'startDate > endDate'. Post-fix: dateType differs between args
    // (single) and fields (range), so the date trio is dropped from
    // fallback and the explicit-required check fires up front.
    const proposal = makeProposal({
      toolName: "update_week_item",
      kind: "edit",
      targetEntityId: "wi_target_xyz",
      targetEntityType: "week_item",
      args: JSON.stringify({
        title: "TEST Single Verify",
        clientId: "client_xyz",
        projectId: "proj_p1",
        category: "delivery",
        date: "2026-05-06",
        startDate: "2026-05-06",
        endDate: "2026-05-06",
        owner: "Jason Burks",
        resources: ["AM: Lane Jordan"],
        notes: "Single fix verify",
      }),
    });
    const stateValues: StateValues = {
      client_block: { client_select: externalSelectV("client_xyz") },
      parent_project_block: {
        parent_project_select: externalSelectV("proj_p1"),
      },
      date_type_block: { date_type_radio: radioV("range") },
      start_date_block: { start_date_picker: dateV("2026-05-07") },
      // end_date_picker intentionally omitted - user did not touch it.
    };
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors["end_date_block"]).toBe("End date is required.");
    }
  });

  it("Range -> Single toggle, no date touched: rejects with 'Date is required'", async () => {
    // Sibling case: row was Range, args carries startDate/endDate. User
    // toggles to Single without picking a date. Pre-fix: fallback would
    // restore args.startDate into canonical.startDate / endDate, validator
    // passed, consumer wrote a Single row with no date column. Post-fix:
    // the date trio is dropped, explicit-required check demands fields.date.
    state.weekItems[0] = {
      ...state.weekItems[0],
      date: null,
      startDate: "2026-05-04",
      endDate: "2026-05-08",
    };
    const proposal = makeProposal({
      toolName: "update_week_item",
      kind: "edit",
      targetEntityId: "wi_target_xyz",
      targetEntityType: "week_item",
      args: JSON.stringify({
        title: "TEST Single Verify",
        clientId: "client_xyz",
        projectId: "proj_p1",
        category: "delivery",
        startDate: "2026-05-04",
        endDate: "2026-05-08",
        owner: "Jason Burks",
        resources: ["AM: Lane Jordan"],
        notes: "Single fix verify",
      }),
    });
    const stateValues: StateValues = {
      client_block: { client_select: externalSelectV("client_xyz") },
      parent_project_block: {
        parent_project_select: externalSelectV("proj_p1"),
      },
      date_type_block: { date_type_radio: radioV("single") },
      // date_picker intentionally omitted - user toggled but did not pick.
    };
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors["date_block"]).toBe("Date is required.");
    }
  });

  it("Single -> Range toggle, both startDate and endDate provided: save succeeds with new dates (no stale fallback)", async () => {
    // Same setup as the failing case but the user picks BOTH dates.
    // Confirms the toggle path doesn't over-reject when the user supplies
    // the new mode's full required set.
    const proposal = makeProposal({
      toolName: "update_week_item",
      kind: "edit",
      targetEntityId: "wi_target_xyz",
      targetEntityType: "week_item",
      args: JSON.stringify({
        title: "TEST Single Verify",
        clientId: "client_xyz",
        projectId: "proj_p1",
        category: "delivery",
        date: "2026-05-06",
        startDate: "2026-05-06",
        endDate: "2026-05-06",
        owner: "Jason Burks",
        resources: ["AM: Lane Jordan"],
        notes: "Single fix verify",
      }),
    });
    const stateValues: StateValues = {
      client_block: { client_select: externalSelectV("client_xyz") },
      parent_project_block: {
        parent_project_select: externalSelectV("proj_p1"),
      },
      date_type_block: { date_type_radio: radioV("range") },
      start_date_block: { start_date_picker: dateV("2026-05-07") },
      end_date_block: { end_date_picker: dateV("2026-05-11") },
    };
    const result = await validateModalSubmission({
      proposal,
      stateValues,
      db,
    } as unknown as ValidateModalSubmissionParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.startDate).toBe("2026-05-07");
      expect(result.normalized.endDate).toBe("2026-05-11");
      // Title/owner/notes/category fall back from args (Slack omitted those
      // blocks); date trio does NOT fall back because the toggle skipped it.
      expect(result.normalized.title).toBe("TEST Single Verify");
      expect(result.normalized.owner).toBe("Jason Burks");
    }
  });
});


