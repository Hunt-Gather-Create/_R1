/**
 * Tests for the /api/slack/options endpoint.
 *
 * Slack's external_select dropdowns POST `block_suggestion` payloads here
 * when the user opens a typeahead. The route returns
 * `{options: [...]}` shaped per Block Kit spec. Slack rejects empty
 * options arrays, so the route always returns at least one option (a
 * placeholder when no candidates match or a cascade dependency is unset).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSlackSignature, nowTimestamp } from "@/lib/slack/test-helpers";

const SIGNING_SECRET = "test-signing-secret";

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  vi.resetModules();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Mocks for data sources
// ---------------------------------------------------------------------------

const mockGetAllClients = vi.fn();
const mockGetProjectsForFuzzy = vi.fn();
const mockGetTeamMembersForFuzzy = vi.fn();
const mockGetWeekItemsForFuzzy = vi.fn();

vi.mock("@/lib/runway/operations-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/runway/operations-utils")>(
    "@/lib/runway/operations-utils",
  );
  return {
    ...actual,
    getAllClients: () => mockGetAllClients(),
  };
});

vi.mock("@/lib/runway/data-for-commands", () => ({
  getProjectsForFuzzy: (clientId?: string, opts?: { engagementType?: string }) =>
    mockGetProjectsForFuzzy(clientId, opts),
  getTeamMembersForFuzzy: (opts?: { excludeRoleCategory?: string }) =>
    mockGetTeamMembersForFuzzy(opts),
  getWeekItemsForFuzzy: (clientId?: string) => mockGetWeekItemsForFuzzy(clientId),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BuildPayloadInput {
  action_id: string;
  block_id?: string;
  value?: string;
  view?: Record<string, unknown>;
}

function buildSuggestionPayload(input: BuildPayloadInput): string {
  const payload = {
    type: "block_suggestion",
    action_id: input.action_id,
    block_id: input.block_id ?? `${input.action_id}_block`,
    value: input.value ?? "",
    team: { id: "T_TEST_team" },
    user: { id: "U_TEST_user" },
    view: input.view ?? { state: { values: {} } },
  };
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
}

function buildRequest(body: string, opts?: { signature?: string; timestamp?: string }) {
  const timestamp = opts?.timestamp ?? nowTimestamp();
  const signature =
    opts?.signature ?? makeSlackSignature(SIGNING_SECRET, timestamp, body);
  return new Request("http://localhost/api/slack/options", {
    method: "POST",
    headers: {
      "x-slack-signature": signature,
      "x-slack-request-timestamp": timestamp,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

async function callRoute(request: Request) {
  const { POST } = await import("./route");
  return POST(request as never);
}

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

describe("POST /api/slack/options — signature verification", () => {
  it("rejects requests with no signature header", async () => {
    const body = buildSuggestionPayload({ action_id: "client_select" });
    const req = new Request("http://localhost/api/slack/options", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const res = await callRoute(req);
    expect(res.status).toBe(403);
  });

  it("rejects requests with a tampered signature", async () => {
    const body = buildSuggestionPayload({ action_id: "client_select" });
    const res = await callRoute(buildRequest(body, { signature: "v0=deadbeef" }));
    expect(res.status).toBe(403);
  });

  it("rejects stale requests (timestamp >5 min old)", async () => {
    const body = buildSuggestionPayload({ action_id: "client_select" });
    const stale = (Math.floor(Date.now() / 1000) - 600).toString();
    const res = await callRoute(buildRequest(body, { timestamp: stale }));
    expect(res.status).toBe(403);
  });

  it("returns 500 when SLACK_SIGNING_SECRET is unset", async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const body = buildSuggestionPayload({ action_id: "client_select" });
    // Build a request without computing a signature (the route bails before verify)
    const req = new Request("http://localhost/api/slack/options", {
      method: "POST",
      headers: {
        "x-slack-signature": "v0=anything",
        "x-slack-request-timestamp": nowTimestamp(),
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const res = await callRoute(req);
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

describe("POST /api/slack/options — payload parsing", () => {
  it("returns a placeholder option for unknown action_id", async () => {
    mockGetAllClients.mockResolvedValue([]);
    const body = buildSuggestionPayload({ action_id: "unknown_picker" });
    const res = await callRoute(buildRequest(body));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options).toHaveLength(1);
    expect(json.options[0].value).toBe("_no_matches");
  });

  it("returns 400 when body is missing the payload field", async () => {
    const body = new URLSearchParams({ other: "noise" }).toString();
    const res = await callRoute(buildRequest(body));
    expect(res.status).toBe(400);
  });

  it("returns 400 when payload field is not valid JSON", async () => {
    const body = new URLSearchParams({ payload: "not-json{" }).toString();
    const res = await callRoute(buildRequest(body));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// client_select
// ---------------------------------------------------------------------------

describe("POST /api/slack/options — client_select", () => {
  it("returns all clients as options when query is empty", async () => {
    mockGetAllClients.mockResolvedValue([
      { id: "c1", name: "Acme Co", slug: "acme" },
      { id: "c2", name: "Beta Inc", slug: "beta" },
    ]);
    const body = buildSuggestionPayload({ action_id: "client_select", value: "" });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ text: { text: string }; value: string }> };
    expect(res.status).toBe(200);
    expect(json.options).toHaveLength(2);
    expect(json.options.map((o) => o.value)).toEqual(["c1", "c2"]);
    expect(json.options.map((o) => o.text.text)).toEqual(["Acme Co", "Beta Inc"]);
  });

  it("fuzzy-filters clients by typed query", async () => {
    mockGetAllClients.mockResolvedValue([
      { id: "c1", name: "Acme Co", slug: "acme" },
      { id: "c2", name: "Beta Inc", slug: "beta" },
      { id: "c3", name: "Acme Holdings", slug: "acme-holdings" },
    ]);
    const body = buildSuggestionPayload({ action_id: "client_select", value: "acme" });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(res.status).toBe(200);
    const values = json.options.map((o) => o.value);
    // Both Acme entries should match; Beta should not.
    expect(values).toContain("c1");
    expect(values).toContain("c3");
    expect(values).not.toContain("c2");
  });

  it("returns no-matches placeholder when no clients exist", async () => {
    mockGetAllClients.mockResolvedValue([]);
    const body = buildSuggestionPayload({ action_id: "client_select", value: "" });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options[0].value).toBe("_no_matches");
  });

  it("caps results at 100 options", async () => {
    const manyClients = Array.from({ length: 150 }, (_, i) => ({
      id: `c${i}`,
      name: `Client ${i}`,
      slug: `client-${i}`,
    }));
    mockGetAllClients.mockResolvedValue(manyClients);
    const body = buildSuggestionPayload({ action_id: "client_select", value: "" });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: unknown[] };
    expect(json.options.length).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// parent_project_select (cascade on client_select)
// ---------------------------------------------------------------------------

describe("POST /api/slack/options — parent_project_select cascade", () => {
  it("returns no-matches placeholder when client is not yet selected", async () => {
    const body = buildSuggestionPayload({
      action_id: "parent_project_select",
      view: { state: { values: {} } },
    });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string; text: { text: string } }> };
    expect(json.options).toHaveLength(1);
    expect(json.options[0].value).toBe("_no_client");
    expect(json.options[0].text.text.toLowerCase()).toContain("client");
  });

  it("returns projects for the selected client only", async () => {
    mockGetProjectsForFuzzy.mockResolvedValue([
      { id: "p1", name: "Q3 Redesign", clientId: "c1" },
      { id: "p2", name: "Brand Refresh", clientId: "c1" },
    ]);
    const body = buildSuggestionPayload({
      action_id: "parent_project_select",
      view: {
        state: {
          values: {
            client_block: {
              client_select: { selected_option: { value: "c1" } },
            },
          },
        },
      },
    });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(res.status).toBe(200);
    expect(mockGetProjectsForFuzzy).toHaveBeenCalledWith("c1", undefined);
    expect(json.options.map((o) => o.value)).toEqual(["p1", "p2"]);
  });

  it("fuzzy-filters projects by typed query", async () => {
    mockGetProjectsForFuzzy.mockResolvedValue([
      { id: "p1", name: "Q3 Redesign", clientId: "c1" },
      { id: "p2", name: "Brand Refresh", clientId: "c1" },
    ]);
    const body = buildSuggestionPayload({
      action_id: "parent_project_select",
      value: "redesign",
      view: {
        state: {
          values: {
            client_block: {
              client_select: { selected_option: { value: "c1" } },
            },
          },
        },
      },
    });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options.map((o) => o.value)).toContain("p1");
    expect(json.options.map((o) => o.value)).not.toContain("p2");
  });
});

// ---------------------------------------------------------------------------
// parent_retainer_picker (cascade on client_select + retainer-only filter)
// ---------------------------------------------------------------------------

describe("POST /api/slack/options — parent_retainer_picker cascade", () => {
  it("filters to retainer-mode projects only", async () => {
    mockGetProjectsForFuzzy.mockResolvedValue([
      { id: "p1", name: "AG1 Pro 2026", clientId: "c1" },
    ]);
    const body = buildSuggestionPayload({
      action_id: "parent_retainer_picker",
      view: {
        state: {
          values: {
            client_block: {
              client_select: { selected_option: { value: "c1" } },
            },
          },
        },
      },
    });
    const res = await callRoute(buildRequest(body));
    expect(res.status).toBe(200);
    expect(mockGetProjectsForFuzzy).toHaveBeenCalledWith("c1", { engagementType: "retainer" });
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options.map((o) => o.value)).toEqual(["p1"]);
  });

  it("returns no-client placeholder when client unset", async () => {
    const body = buildSuggestionPayload({
      action_id: "parent_retainer_picker",
      view: { state: { values: {} } },
    });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options[0].value).toBe("_no_client");
  });
});

// ---------------------------------------------------------------------------
// owner_select
// ---------------------------------------------------------------------------

describe("POST /api/slack/options — owner_select", () => {
  it("returns active team members with fullName preferred over name", async () => {
    // Mock filters by roleCategory before returning — handler passes
    // {excludeRoleCategory: "contractor"} so contractors never reach this list.
    mockGetTeamMembersForFuzzy.mockImplementation((opts?: { excludeRoleCategory?: string }) => {
      const all = [
        { id: "t1", name: "Lane", fullName: "Lane Carter", roleCategory: "creative", isActive: 1 },
        { id: "t2", name: "Sami", fullName: null, roleCategory: "pm", isActive: 1 },
        { id: "t3", name: "Jordan", fullName: "Jordan Reed", roleCategory: "dev", isActive: 0 },
      ];
      return Promise.resolve(
        opts?.excludeRoleCategory
          ? all.filter((m) => m.roleCategory !== opts.excludeRoleCategory)
          : all,
      );
    });
    const body = buildSuggestionPayload({ action_id: "owner_select" });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as {
      options: Array<{ value: string; text: { text: string } }>;
    };
    expect(res.status).toBe(200);
    const values = json.options.map((o) => o.value);
    expect(values).toContain("t1");
    expect(values).toContain("t2");
    // Inactive member should be filtered out.
    expect(values).not.toContain("t3");
    const labels = json.options.map((o) => o.text.text);
    expect(labels).toContain("Lane Carter"); // fullName preferred
    expect(labels).toContain("Sami"); // falls back to name when fullName null
  });

  it("fuzzy-filters by query", async () => {
    mockGetTeamMembersForFuzzy.mockResolvedValue([
      { id: "t1", name: "Lane", fullName: "Lane Carter", roleCategory: "creative", isActive: 1 },
      { id: "t2", name: "Sami", fullName: "Sami Patel", roleCategory: "pm", isActive: 1 },
    ]);
    const body = buildSuggestionPayload({ action_id: "owner_select", value: "lane" });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options.map((o) => o.value)).toContain("t1");
    expect(json.options.map((o) => o.value)).not.toContain("t2");
  });

  it("excludes contractors from the staff-only owner picker", async () => {
    mockGetTeamMembersForFuzzy.mockImplementation((opts?: { excludeRoleCategory?: string }) => {
      // Real getTeamMembersForFuzzy filters by excludeRoleCategory before
      // returning. Mirror that here so the test exercises both layers.
      const all = [
        { id: "t1", name: "Lane", fullName: "Lane Carter", roleCategory: "creative", isActive: 1 },
        { id: "t9", name: "Riley", fullName: "Riley Vendor", roleCategory: "contractor", isActive: 1 },
      ];
      return Promise.resolve(
        opts?.excludeRoleCategory
          ? all.filter((m) => m.roleCategory !== opts.excludeRoleCategory)
          : all,
      );
    });
    const body = buildSuggestionPayload({ action_id: "owner_select" });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    const values = json.options.map((o) => o.value);
    expect(values).toContain("t1");
    expect(values).not.toContain("t9");
    // Verify the handler passed the right exclusion option through.
    expect(mockGetTeamMembersForFuzzy).toHaveBeenCalledWith({
      excludeRoleCategory: "contractor",
    });
  });
});

// ---------------------------------------------------------------------------
// resources_name_N (cascade on resources_role_N)
// ---------------------------------------------------------------------------

describe("POST /api/slack/options — resources_name_N cascade", () => {
  it("filters team members by mapped roleCategory when role is selected", async () => {
    mockGetTeamMembersForFuzzy.mockResolvedValue([
      { id: "t1", name: "Lane", fullName: "Lane Carter", roleCategory: "creative", isActive: 1 },
      { id: "t2", name: "Sami", fullName: "Sami Patel", roleCategory: "pm", isActive: 1 },
    ]);
    const body = buildSuggestionPayload({
      action_id: "resources_name_0",
      block_id: "resources_name_block_0",
      view: {
        state: {
          values: {
            resources_block_0: {
              resources_role_0: { selected_option: { value: "CD" } },
            },
          },
        },
      },
    });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(res.status).toBe(200);
    expect(json.options.map((o) => o.value)).toContain("t1"); // CD → creative
    expect(json.options.map((o) => o.value)).not.toContain("t2");
  });

  it("maps Strat short code to strategy bucket", async () => {
    mockGetTeamMembersForFuzzy.mockResolvedValue([
      { id: "t1", name: "Lane", fullName: "Lane Carter", roleCategory: "creative", isActive: 1 },
      { id: "t4", name: "Riley", fullName: "Riley Kim", roleCategory: "strategy", isActive: 1 },
    ]);
    const body = buildSuggestionPayload({
      action_id: "resources_name_2",
      block_id: "resources_name_block_2",
      view: {
        state: {
          values: {
            resources_block_2: {
              resources_role_2: { selected_option: { value: "Strat" } },
            },
          },
        },
      },
    });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options.map((o) => o.value)).toEqual(["t4"]);
  });

  it("returns all active team members when role is unselected", async () => {
    mockGetTeamMembersForFuzzy.mockResolvedValue([
      { id: "t1", name: "Lane", fullName: "Lane Carter", roleCategory: "creative", isActive: 1 },
      { id: "t2", name: "Sami", fullName: "Sami Patel", roleCategory: "pm", isActive: 1 },
    ]);
    const body = buildSuggestionPayload({
      action_id: "resources_name_0",
      block_id: "resources_name_block_0",
      view: { state: { values: {} } },
    });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options.map((o) => o.value).sort()).toEqual(["t1", "t2"]);
  });

  it("falls back to all active members when role short code is unknown", async () => {
    mockGetTeamMembersForFuzzy.mockResolvedValue([
      { id: "t1", name: "Lane", fullName: "Lane Carter", roleCategory: "creative", isActive: 1 },
    ]);
    const body = buildSuggestionPayload({
      action_id: "resources_name_1",
      block_id: "resources_name_block_1",
      view: {
        state: {
          values: {
            resources_block_1: {
              resources_role_1: { selected_option: { value: "Mystery" } },
            },
          },
        },
      },
    });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options.map((o) => o.value)).toEqual(["t1"]);
  });

  it("includes contractors (Resources picker is freelance-friendly, unlike Owner)", async () => {
    mockGetTeamMembersForFuzzy.mockResolvedValue([
      { id: "t1", name: "Lane", fullName: "Lane Carter", roleCategory: "contractor", isActive: 1 },
    ]);
    const body = buildSuggestionPayload({
      action_id: "resources_name_0",
      block_id: "resources_name_block_0",
      view: {
        state: {
          values: {
            resources_block_0: {
              resources_role_0: { selected_option: { value: "Vendor" } },
            },
          },
        },
      },
    });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: Array<{ value: string }> };
    expect(json.options.map((o) => o.value)).toEqual(["t1"]);
    // Resources handler must NOT pass excludeRoleCategory.
    expect(mockGetTeamMembersForFuzzy).not.toHaveBeenCalledWith(
      expect.objectContaining({ excludeRoleCategory: expect.anything() }),
    );
  });
});

// ---------------------------------------------------------------------------
// Cap-at-100 across all pickers (single representative test for team_members)
// ---------------------------------------------------------------------------

describe("POST /api/slack/options — pagination cap", () => {
  it("caps owner_select at 100 even with 200 members", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `t${i}`,
      name: `Member ${i}`,
      fullName: `Member ${i}`,
      roleCategory: "creative",
      isActive: 1,
    }));
    mockGetTeamMembersForFuzzy.mockResolvedValue(many);
    const body = buildSuggestionPayload({ action_id: "owner_select" });
    const res = await callRoute(buildRequest(body));
    const json = (await res.json()) as { options: unknown[] };
    expect(json.options.length).toBeLessThanOrEqual(100);
  });
});
