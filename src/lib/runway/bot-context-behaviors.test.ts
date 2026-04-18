import { describe, it, expect } from "vitest";
import {
  buildGlossary,
  buildRoleBehavior,
  buildProactiveBehavior,
  buildConfirmationRules,
  buildToneRules,
  buildCapabilityBoundaries,
} from "./bot-context-behaviors";

describe("buildGlossary", () => {
  it("returns a string with glossary heading", () => {
    const result = buildGlossary();
    expect(result).toContain("## Natural language glossary");
  });

  it("includes status update mappings", () => {
    const result = buildGlossary();
    expect(result).toContain("out the door");
    expect(result).toContain("delivered");
    expect(result).toContain("completed");
  });

  it("includes query patterns", () => {
    const result = buildGlossary();
    expect(result).toContain("on tap");
    expect(result).toContain("on my plate");
  });

  it("includes correction patterns", () => {
    const result = buildGlossary();
    expect(result).toContain("scratch that");
    expect(result).toContain("undo last action");
  });

  it("includes uncertainty handling", () => {
    const result = buildGlossary();
    expect(result).toContain("Unconfirmed:");
  });
});

describe("buildRoleBehavior", () => {
  it("returns role-based behavior section", () => {
    const result = buildRoleBehavior();
    expect(result).toContain("## Role-based behavior");
  });

  it("covers all role types", () => {
    const result = buildRoleBehavior();
    expect(result).toContain("AM asking");
    expect(result).toContain("Creative/dev");
    expect(result).toContain("PM asking");
    expect(result).toContain("Leadership");
  });

  it("includes multi-step task handling", () => {
    const result = buildRoleBehavior();
    expect(result).toContain("mark complete");
    expect(result).toContain("suggest next task");
  });
});

describe("buildProactiveBehavior", () => {
  it("returns proactive behavior section", () => {
    const result = buildProactiveBehavior();
    expect(result).toContain("## Proactive behavior");
  });

  it("includes multi-update handling", () => {
    const result = buildProactiveBehavior();
    expect(result).toContain("## Multi-update messages");
    expect(result).toContain("Process each update separately");
  });

  it("warns against duplicating stale-item follow-up", () => {
    const result = buildProactiveBehavior();
    expect(result).toContain("Do not duplicate this check");
  });

  it("includes contradiction detection", () => {
    const result = buildProactiveBehavior();
    expect(result).toContain("flag the contradiction");
  });
});

describe("buildConfirmationRules", () => {
  it("returns confirmation rules section", () => {
    const result = buildConfirmationRules();
    expect(result).toContain("## Confirmation rules");
  });

  it("lists actions requiring confirmation", () => {
    const result = buildConfirmationRules();
    expect(result).toContain("completed");
    expect(result).toContain("on-hold");
    expect(result).toContain("Changing project owner");
    expect(result).toContain("Creating a new project");
  });

  it("lists actions not requiring confirmation", () => {
    const result = buildConfirmationRules();
    expect(result).toContain("No confirmation needed");
    expect(result).toContain("Logging notes");
    expect(result).toContain("Read-only queries");
  });

  it("includes ambiguity handling", () => {
    const result = buildConfirmationRules();
    expect(result).toContain("## Ambiguity");
    expect(result).toContain("ask which one");
  });
});

describe("buildToneRules", () => {
  it("returns tone rules section", () => {
    const result = buildToneRules();
    expect(result).toContain("## Tone and emotional awareness");
  });

  it("includes empathy guidance", () => {
    const result = buildToneRules();
    expect(result).toContain("acknowledge empathetically");
  });

  it("includes no AI voice rule", () => {
    const result = buildToneRules();
    expect(result).toContain("no AI voice");
    expect(result).toContain("No em dashes");
  });
});

describe("buildCapabilityBoundaries", () => {
  it("lists what the bot CAN do", () => {
    const result = buildCapabilityBoundaries();
    expect(result).toContain("## What you CAN do");
    expect(result).toContain("update_project_status");
    expect(result).toContain("update_project_field");
    expect(result).toContain("create_project");
    expect(result).toContain("create_week_item");
    expect(result).toContain("update_week_item");
    expect(result).toContain("undo_last_change");
    expect(result).toContain("get_recent_updates");
  });

  it("lists what the bot CANNOT do", () => {
    const result = buildCapabilityBoundaries();
    expect(result).toContain("## What you CANNOT do");
    expect(result).toContain("Set reminders");
    expect(result).toContain("billing");
  });

  it("includes critical add_update vs update_project_field distinction", () => {
    const result = buildCapabilityBoundaries();
    expect(result).toContain("## CRITICAL: add_update vs update_project_field");
    expect(result).toContain("does NOT change any database field");
    expect(result).toContain("NEVER tell the user a field was changed unless");
  });
});
