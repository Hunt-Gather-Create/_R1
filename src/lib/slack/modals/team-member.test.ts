import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ROLE_CATEGORY_OPTIONS,
  buildTeamMemberModal,
  type BuildTeamMemberModalParams,
} from "./team-member";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function findBlock(blocks: ReadonlyArray<{ block_id?: string }>, blockId: string) {
  return blocks.find((b) => b.block_id === blockId);
}

const BASE_PROPOSAL_ID = "prop_01JKVQXBTEAMMEMBER001ABCDE";

function baseCreateParams(
  overrides: Partial<BuildTeamMemberModalParams> = {},
): BuildTeamMemberModalParams {
  return {
    args: {},
    proposalId: BASE_PROPOSAL_ID,
    mode: "create",
    ...overrides,
  };
}

function baseEditParams(
  overrides: Partial<BuildTeamMemberModalParams> = {},
): BuildTeamMemberModalParams {
  return {
    args: {},
    proposalId: BASE_PROPOSAL_ID,
    mode: "edit",
    currentValues: {
      fullName: "Sam Rivera",
      clientId: "client_01JKCLIENTAG10001ABCDEFGHJ",
      roleCategory: "creative",
      email: "sam@example.test",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Header / shape
// ---------------------------------------------------------------------------

describe("buildTeamMemberModal — create", () => {
  it("renders the locked v7 create header", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    expect(view.type).toBe("modal");
    expect(view.title.type).toBe("plain_text");
    expect(view.title.text).toBe("New team member");
  });

  it("uses the create callback_id", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    expect(view.callback_id).toBe("runway_new_team_member");
  });

  it("serializes the proposalId into private_metadata as JSON", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    expect(view.private_metadata).toBe(JSON.stringify({ proposalId: BASE_PROPOSAL_ID }));
    const parsed = JSON.parse(view.private_metadata!);
    expect(parsed.proposalId).toBe(BASE_PROPOSAL_ID);
  });

  it("declares submit and close buttons (input blocks present)", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    expect(view.submit?.text).toBe("Save");
    expect(view.close?.text).toBe("Cancel");
  });

  it("has all four expected blocks (client, name, role, email)", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    const blockIds = view.blocks.map((b) => (b as { block_id?: string }).block_id);
    expect(blockIds).toEqual([
      "client_block",
      "name_block",
      "role_category_block",
      "email_block",
    ]);
  });

  it("leaves all input fields blank in create mode", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    const nameBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "name_block",
    ) as { element?: { initial_value?: string } } | undefined;
    expect(nameBlock?.element?.initial_value).toBeUndefined();

    const emailBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "email_block",
    ) as { element?: { initial_value?: string } } | undefined;
    expect(emailBlock?.element?.initial_value).toBeUndefined();

    const clientBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "client_block",
    ) as { element?: { initial_option?: unknown } } | undefined;
    expect(clientBlock?.element?.initial_option).toBeUndefined();

    const roleBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "role_category_block",
    ) as { element?: { initial_option?: unknown } } | undefined;
    expect(roleBlock?.element?.initial_option).toBeUndefined();
  });
});

describe("buildTeamMemberModal — edit", () => {
  it("renders the edit header with the full name interpolated and hyphen-space-hyphen", () => {
    // "Edit team member - Sam Rivera" is 29 chars; Slack rejects modal titles
    // with length >= 25, so the builder truncates with ' ... '. The truncated
    // header still starts with the locked prefix and uses hyphen-space-hyphen.
    const view = buildTeamMemberModal(baseEditParams());
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.startsWith("Edit team member - ")).toBe(true);
    expect(view.title.text.endsWith("...")).toBe(true);
    expect(view.title.text).not.toMatch(/\u2014/);
  });

  it("uses the edit callback_id", () => {
    const view = buildTeamMemberModal(baseEditParams());
    expect(view.callback_id).toBe("runway_edit_team_member");
  });

  it("pre-fills the full name input from currentValues", () => {
    const view = buildTeamMemberModal(baseEditParams());
    const nameBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "name_block",
    ) as { element?: { initial_value?: string } } | undefined;
    expect(nameBlock?.element?.initial_value).toBe("Sam Rivera");
  });

  it("pre-fills the email input from currentValues", () => {
    const view = buildTeamMemberModal(baseEditParams());
    const emailBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "email_block",
    ) as { element?: { initial_value?: string } } | undefined;
    expect(emailBlock?.element?.initial_value).toBe("sam@example.test");
  });

  it("pre-selects the role category from currentValues", () => {
    const view = buildTeamMemberModal(baseEditParams());
    const roleBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "role_category_block",
    ) as { element?: { initial_option?: { value?: string } } } | undefined;
    expect(roleBlock?.element?.initial_option?.value).toBe("creative");
  });

  it("pre-selects the client from currentValues.clientId", () => {
    const view = buildTeamMemberModal(baseEditParams());
    const clientBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "client_block",
    ) as { element?: { initial_option?: { value?: string } } } | undefined;
    expect(clientBlock?.element?.initial_option?.value).toBe(
      "client_01JKCLIENTAG10001ABCDEFGHJ",
    );
  });

  it("falls back to a placeholder header when fullName is missing", () => {
    const view = buildTeamMemberModal(
      baseEditParams({ currentValues: { clientId: "x" } }),
    );
    // Header is still type-aware: edit, but with empty interpolation it should
    // still use the editTeamMember formatter -> "Edit team member - "
    expect(view.title.text.startsWith("Edit team member - ")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// notify_on_close — Wave 11 wires view_closed; without this flag Slack does
// not deliver the dismiss event to our interactivity webhook.
// ---------------------------------------------------------------------------

describe("notify_on_close (Wave 11 contract)", () => {
  it("sets notify_on_close=true on the create view", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    expect((view as { notify_on_close?: boolean }).notify_on_close).toBe(true);
  });

  it("sets notify_on_close=true on the edit view", () => {
    const view = buildTeamMemberModal(baseEditParams());
    expect((view as { notify_on_close?: boolean }).notify_on_close).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Role category enum coverage
// ---------------------------------------------------------------------------

describe("ROLE_CATEGORY_OPTIONS", () => {
  it("contains all 7 schema-truth role categories", () => {
    expect(ROLE_CATEGORY_OPTIONS).toHaveLength(7);
    const values = ROLE_CATEGORY_OPTIONS.map((o) => o.value).sort();
    expect(values).toEqual(
      ["am", "community", "contractor", "creative", "dev", "leadership", "pm"].sort(),
    );
  });

  it("uses lowercase enum values matching teamMembers.roleCategory in runway-schema.ts", () => {
    for (const opt of ROLE_CATEGORY_OPTIONS) {
      expect(opt.value).toBe(opt.value.toLowerCase());
    }
  });

  it("renders all 7 options in the role_category dropdown", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    const roleBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "role_category_block",
    ) as
      | { element?: { options?: ReadonlyArray<{ value: string }> } }
      | undefined;
    expect(roleBlock?.element?.options).toHaveLength(7);
    const values = (roleBlock?.element?.options ?? []).map((o) => o.value).sort();
    expect(values).toEqual(
      ["am", "community", "contractor", "creative", "dev", "leadership", "pm"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Required / optional markers
// ---------------------------------------------------------------------------

describe("required field markers", () => {
  it("client, name, and role_category blocks are required", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    const blocks = view.blocks as Array<{ block_id?: string; optional?: boolean }>;
    const required = ["client_block", "name_block", "role_category_block"];
    for (const id of required) {
      const block = blocks.find((b) => b.block_id === id);
      // Slack's `optional: false` is the default for input blocks; we accept
      // either the property being absent OR explicitly set to false.
      expect(block?.optional ?? false).toBe(false);
    }
  });

  it("email block is optional", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    const blocks = view.blocks as Array<{ block_id?: string; optional?: boolean }>;
    const emailBlock = blocks.find((b) => b.block_id === "email_block");
    expect(emailBlock?.optional).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error block rendering
// ---------------------------------------------------------------------------

describe("error block rendering", () => {
  it("prepends a section error block when errorBlock is supplied", () => {
    const view = buildTeamMemberModal({
      ...baseCreateParams(),
      errorBlock: { blockId: "name_block", message: "Name already exists." },
    });
    const first = view.blocks[0] as { type: string; block_id?: string };
    expect(first.type).toBe("section");
    expect(first.block_id).toBe("error_block");
  });

  it("does not render an error block when errorBlock is omitted", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    const first = view.blocks[0] as { block_id?: string };
    expect(first.block_id).toBe("client_block");
  });
});

// ---------------------------------------------------------------------------
// args pre-fill on create mode (LLM-extracted args from intercept)
// ---------------------------------------------------------------------------

describe("create mode pre-fill from args", () => {
  it("pre-fills the full name from args.fullName", () => {
    const view = buildTeamMemberModal({
      ...baseCreateParams({ args: { fullName: "Casey Quinn" } }),
    });
    const nameBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "name_block",
    ) as { element?: { initial_value?: string } } | undefined;
    expect(nameBlock?.element?.initial_value).toBe("Casey Quinn");
  });

  it("pre-fills the email from args.email", () => {
    const view = buildTeamMemberModal({
      ...baseCreateParams({ args: { email: "casey@example.test" } }),
    });
    const emailBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "email_block",
    ) as { element?: { initial_value?: string } } | undefined;
    expect(emailBlock?.element?.initial_value).toBe("casey@example.test");
  });

  it("pre-selects the role category from args.roleCategory", () => {
    const view = buildTeamMemberModal({
      ...baseCreateParams({ args: { roleCategory: "dev" } }),
    });
    const roleBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "role_category_block",
    ) as { element?: { initial_option?: { value?: string } } } | undefined;
    expect(roleBlock?.element?.initial_option?.value).toBe("dev");
  });

  it("ignores an unknown roleCategory value rather than crashing", () => {
    const view = buildTeamMemberModal({
      ...baseCreateParams({ args: { roleCategory: "bogus" } }),
    });
    const roleBlock = findBlock(
      view.blocks as Array<{ block_id?: string }>,
      "role_category_block",
    ) as { element?: { initial_option?: { value?: string } } } | undefined;
    expect(roleBlock?.element?.initial_option).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Slack hard-limits — title length + empty-options guards
// ---------------------------------------------------------------------------

function* walkStaticSelectOptionsArrays(
  obj: unknown,
): Generator<{ path: string; options: unknown[] }> {
  function* walk(node: unknown, path: string): Generator<{ path: string; options: unknown[] }> {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.type === "static_select" && Array.isArray(rec.options)) {
      yield { path: `${path}.options`, options: rec.options };
    }
    for (const [k, v] of Object.entries(rec)) {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          yield* walk(v[i], `${path}.${k}[${i}]`);
        }
      } else if (v && typeof v === "object") {
        yield* walk(v, `${path}.${k}`);
      }
    }
  }
  yield* walk(obj, "$");
}

describe("buildTeamMemberModal — Slack title-length guard (≤24 chars)", () => {
  it("create-mode title fits the cap", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });

  it("edit-mode title with short name fits the cap", () => {
    const view = buildTeamMemberModal(baseEditParams());
    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });

  it("edit-mode title with 100-char fullName fits the cap (truncation)", () => {
    const view = buildTeamMemberModal(
      baseEditParams({ currentValues: { fullName: "X".repeat(100) } }),
    );
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.endsWith("...")).toBe(true);
  });
});

describe("buildTeamMemberModal — Slack empty-options guard", () => {
  // Note: the client_block currently uses a single-item placeholder option that
  // the route handler patches at views.open time. The guard below permits that
  // (length >= 1). Real options are injected before the API call.
  it("emits no static_select with empty options (default create render)", () => {
    const view = buildTeamMemberModal(baseCreateParams());
    const offenders: string[] = [];
    for (const { path, options } of walkStaticSelectOptionsArrays(view)) {
      if (options.length === 0) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("emits no static_select with empty options (edit render)", () => {
    const view = buildTeamMemberModal(baseEditParams());
    const offenders: string[] = [];
    for (const { path, options } of walkStaticSelectOptionsArrays(view)) {
      if (options.length === 0) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Source-level grep guard — Civ voice rules
// ---------------------------------------------------------------------------

describe("source-level grep guard on team-member.ts", () => {
  const sourcePath = path.join(__dirname, "team-member.ts");
  const source = fs.readFileSync(sourcePath, "utf8");

  it("contains zero em-dash characters (U+2014)", () => {
    expect(source.includes("\u2014")).toBe(false);
  });

  it("contains zero en-dash characters (U+2013)", () => {
    expect(source.includes("\u2013")).toBe(false);
  });

  it("contains zero L1 or L2 user-facing tokens", () => {
    // Word-boundary match so we don't trip on identifiers like 'L10n'.
    // Comments may reference codebase concepts but this builder has no
    // legitimate need for L1/L2; keep the grep clean.
    expect(source.match(/\bL[12]\b/)).toBeNull();
  });
});
