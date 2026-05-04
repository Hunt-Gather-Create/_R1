import { describe, expect, it } from "vitest";
import {
  classifyProject,
  resolveClientFromList,
  resolveProjectFromList,
} from "./resolve-helpers";
import type { ClientRow, ProjectRow } from "./types";

const NOW = new Date("2026-04-28T00:00:00Z");

function makeClient(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: "c-default",
    name: "Default Client",
    slug: "default-client",
    nicknames: null,
    contractValue: null,
    contractTerm: null,
    contractStatus: null,
    team: null,
    clientContacts: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p-default",
    clientId: "c-default",
    name: "Default Project",
    status: null,
    category: null,
    owner: null,
    resources: null,
    waitingOn: null,
    dueDate: null,
    startDate: null,
    endDate: null,
    contractStart: null,
    contractEnd: null,
    engagementType: null,
    parentProjectId: null,
    notes: null,
    staleDays: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("classifyProject", () => {
  const baseRetainer = makeProject({
    id: "wrapper",
    engagementType: "retainer",
    parentProjectId: null,
  });
  const child = makeProject({ id: "child", parentProjectId: "wrapper" });

  it("classifies retainer with children as wrapper", () => {
    const result = classifyProject(baseRetainer, [child]);
    expect(result.kind).toBe("wrapper");
    if (result.kind === "wrapper") {
      expect(result.childProjects).toHaveLength(1);
    }
  });

  it("treats retainer with no children as L1 (degenerate)", () => {
    const result = classifyProject(baseRetainer, []);
    expect(result.kind).toBe("l1");
  });

  it("treats non-retainer engagement as L1 even with children", () => {
    const project = makeProject({
      id: "px",
      engagementType: "project",
      parentProjectId: null,
    });
    const result = classifyProject(project, [child]);
    expect(result.kind).toBe("l1");
  });

  it("treats sub-project (parentProjectId set) as L1", () => {
    const subProject = makeProject({
      id: "sub",
      engagementType: "retainer",
      parentProjectId: "wrapper",
    });
    const result = classifyProject(subProject, []);
    expect(result.kind).toBe("l1");
  });

  it("treats null engagementType as L1", () => {
    const project = makeProject({ engagementType: null, parentProjectId: null });
    const result = classifyProject(project, [child]);
    expect(result.kind).toBe("l1");
  });
});

describe("resolveProjectFromList", () => {
  const ag1 = makeClient({ id: "c-ag1", name: "AG1", slug: "ag1" });
  const cgx = makeClient({ id: "c-cgx", name: "Convergix", slug: "convergix" });
  const clientsById = new Map([
    [ag1.id, ag1],
    [cgx.id, cgx],
  ]);

  const wrapper = makeProject({
    id: "p-ag1-wrap",
    clientId: ag1.id,
    name: "AG1",
    engagementType: "retainer",
  });
  const proContent = makeProject({
    id: "p-ag1-pro",
    clientId: ag1.id,
    name: "AG1 PRO Content",
    parentProjectId: wrapper.id,
  });
  const cdsMessaging = makeProject({
    id: "p-cgx-cds",
    clientId: cgx.id,
    name: "CDS Messaging",
  });

  const allProjects = [wrapper, proContent, cdsMessaging];

  it("matches by exact id", () => {
    const result = resolveProjectFromList(allProjects, clientsById, "p-cgx-cds");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.id).toBe("p-cgx-cds");
  });

  it("matches by exact name", () => {
    const result = resolveProjectFromList(allProjects, clientsById, "CDS Messaging");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.id).toBe("p-cgx-cds");
  });

  it("matches by qualified Client / Name", () => {
    const result = resolveProjectFromList(
      allProjects,
      clientsById,
      "Convergix / CDS Messaging",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.id).toBe("p-cgx-cds");
  });

  it("matches by client slug + project name", () => {
    // Mimics --project "hdl Website Build" — slug-qualified key
    const hdl = makeClient({ id: "c-hdl", name: "High Desert Law", slug: "hdl" });
    const websiteBuild = makeProject({
      id: "p-hdl-web",
      clientId: hdl.id,
      name: "Website Build",
    });
    const result = resolveProjectFromList(
      [websiteBuild],
      new Map([[hdl.id, hdl]]),
      "hdl Website Build",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.id).toBe("p-hdl-web");
  });

  it("matches by nickname + project name", () => {
    const cgxNick = makeClient({
      id: "c-cgx2",
      name: "1H Convergix",
      slug: "convergix-1h",
      nicknames: JSON.stringify(["CGX", "Convergix"]),
    });
    const retainer = makeProject({
      id: "p-cgx-ret",
      clientId: cgxNick.id,
      name: "1H Convergix Retainer",
      engagementType: "retainer",
    });
    const result = resolveProjectFromList(
      [retainer],
      new Map([[cgxNick.id, cgxNick]]),
      "CGX / 1H Convergix Retainer",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.id).toBe("p-cgx-ret");
  });

  it("collapses multiple key-hits for the same project to a single match", () => {
    // Input matches BOTH name-qualified and slug-qualified keys for one project;
    // the resolver should not treat this as ambiguous.
    const hdl = makeClient({ id: "c-hdl", name: "High Desert Law", slug: "hdl" });
    const websiteBuild = makeProject({
      id: "p-hdl-web",
      clientId: hdl.id,
      name: "Website Build",
    });
    const result = resolveProjectFromList(
      [websiteBuild],
      new Map([[hdl.id, hdl]]),
      "Website Build",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.id).toBe("p-hdl-web");
  });

  it("tolerates malformed nicknames JSON without throwing", () => {
    const broken = makeClient({
      id: "c-broken",
      name: "Broken",
      slug: "broken",
      nicknames: "{not-valid-json",
    });
    const project = makeProject({
      id: "p-broken",
      clientId: broken.id,
      name: "Project",
    });
    const result = resolveProjectFromList(
      [project],
      new Map([[broken.id, broken]]),
      "Project",
    );
    expect(result.ok).toBe(true);
  });

  it("returns disambiguation list when multiple names share a startsWith substring", () => {
    // No exact-name match on "AG1 P" — but two projects start with it.
    const social = makeProject({
      id: "p-ag1-social",
      clientId: ag1.id,
      name: "AG1 PRO Social Drafts",
    });
    const result = resolveProjectFromList(
      [...allProjects, social],
      clientsById,
      "AG1 P",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Multiple projects match 'AG1 P'/);
      expect(result.error).toContain("Use --project <id> or a more specific name");
      expect(result.available).toEqual(
        expect.arrayContaining(["AG1: AG1 PRO Content (id=p-ag1-pro)", "AG1: AG1 PRO Social Drafts (id=p-ag1-social)"]),
      );
    }
  });

  it("prefers exact-name match over substring even when other names share the substring", () => {
    // "AG1" exactly matches the wrapper despite other projects whose names contain "AG1".
    const social = makeProject({
      id: "p-ag1-social",
      clientId: ag1.id,
      name: "AG1 Social Drafts",
    });
    const result = resolveProjectFromList(
      [...allProjects, social],
      clientsById,
      "AG1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.id).toBe("p-ag1-wrap");
  });

  it("returns not-found error with full list on no match", () => {
    const result = resolveProjectFromList(allProjects, clientsById, "Nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Project 'Nope' not found.");
      expect(result.available).toContain("AG1: AG1 (id=p-ag1-wrap)");
    }
  });

  it("renders unknown clientId as '?' in disambiguation labels", () => {
    const orphan = makeProject({
      id: "p-orphan",
      clientId: "c-missing",
      name: "Orphan Project",
    });
    const result = resolveProjectFromList([orphan], clientsById, "Nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.available).toContain("?: Orphan Project (id=p-orphan)");
  });
});

describe("resolveClientFromList", () => {
  const ag1 = makeClient({ id: "c-ag1", name: "AG1", slug: "ag1" });
  const cgx = makeClient({ id: "c-cgx", name: "Convergix", slug: "convergix" });
  const conv2 = makeClient({ id: "c-conv2", name: "Convergent Group", slug: "convergent-group" });
  const all = [ag1, cgx, conv2];

  it("matches by exact id", () => {
    const result = resolveClientFromList(all, "c-cgx");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.client.id).toBe("c-cgx");
  });

  it("matches by exact slug (case-insensitive)", () => {
    const result = resolveClientFromList(all, "AG1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.client.id).toBe("c-ag1");
  });

  it("matches by fuzzy name when no slug or id hits", () => {
    const result = resolveClientFromList(all, "Convergix");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.client.id).toBe("c-cgx");
  });

  it("returns disambiguation when fuzzy match is ambiguous", () => {
    // "conver" matches both "Convergix" and "Convergent Group" via startsWith
    const result = resolveClientFromList(all, "Conver");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Multiple clients match 'Conver'/);
      expect(result.error).toContain("Use --client <slug>");
      expect(result.available).toEqual(
        expect.arrayContaining(["Convergix (slug=convergix)", "Convergent Group (slug=convergent-group)"]),
      );
    }
  });

  it("returns not-found error on no match", () => {
    const result = resolveClientFromList(all, "Nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Client 'Nope' not found.");
      expect(result.available).toEqual(["AG1", "Convergix", "Convergent Group"]);
      // not-found returns plain client names (not "(slug=...)") since user
      // could match by name; the slug hint is only added on ambiguous-multi.
    }
  });
});
