import { describe, expect, it } from "vitest";
import { buildRawData } from "./build-raw-data";
import type {
  ClientRow,
  ProjectRow,
  ResolvedSubject,
  WeekItemRow,
} from "./types";

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

function makeWeekItem(overrides: Partial<WeekItemRow> = {}): WeekItemRow {
  return {
    id: "w-default",
    projectId: "p-default",
    clientId: "c-default",
    dayOfWeek: null,
    weekOf: null,
    date: null,
    startDate: null,
    endDate: null,
    blockedBy: null,
    title: "Default WeekItem",
    status: null,
    category: null,
    owner: null,
    resources: null,
    notes: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const client = makeClient({ id: "c1", name: "Client One", slug: "client-one" });

describe("buildRawData (l1 view)", () => {
  const l1Project = makeProject({ id: "p-l1", clientId: client.id, name: "Project One" });
  const subject: ResolvedSubject = { kind: "l1", project: l1Project };

  it("returns kind=l1 with empty children when no weekItems", () => {
    const data = buildRawData(subject, client, []);
    expect(data.kind).toBe("l1");
    if (data.kind === "l1") {
      expect(data.children).toEqual([]);
      expect(data.entity.id).toBe("p-l1");
      expect(data.client.id).toBe("c1");
    }
  });

  it("returns kind=l1 with all weekItems as children", () => {
    const items = [
      makeWeekItem({ id: "w1", projectId: "p-l1", title: "Item 1" }),
      makeWeekItem({ id: "w2", projectId: "p-l1", title: "Item 2" }),
    ];
    const data = buildRawData(subject, client, items);
    expect(data.kind).toBe("l1");
    if (data.kind === "l1") {
      expect(data.children).toHaveLength(2);
      expect(data.children.map((c) => c.id)).toEqual(["w1", "w2"]);
    }
  });

  it("treats sub-project (parentProjectId set) the same way", () => {
    const subProject = makeProject({
      id: "p-sub",
      clientId: client.id,
      parentProjectId: "p-wrap",
      name: "Sub-project",
    });
    const subSubject: ResolvedSubject = { kind: "l1", project: subProject };
    const items = [makeWeekItem({ id: "w-sub-1", projectId: "p-sub", title: "Sub item" })];
    const data = buildRawData(subSubject, client, items);
    expect(data.kind).toBe("l1");
    if (data.kind === "l1") {
      expect(data.entity.parentProjectId).toBe("p-wrap");
      expect(data.children).toHaveLength(1);
    }
  });
});

describe("buildRawData (wrapper view)", () => {
  const wrapper = makeProject({
    id: "p-wrap",
    clientId: client.id,
    name: "Wrapper",
    engagementType: "retainer",
  });
  const childA = makeProject({
    id: "p-child-a",
    clientId: client.id,
    parentProjectId: "p-wrap",
    name: "Child A",
  });
  const childB = makeProject({
    id: "p-child-b",
    clientId: client.id,
    parentProjectId: "p-wrap",
    name: "Child B",
  });
  const subject: ResolvedSubject = {
    kind: "wrapper",
    project: wrapper,
    childProjects: [childA, childB],
  };

  it("returns kind=wrapper with child L1 projects as children", () => {
    const data = buildRawData(subject, client, []);
    expect(data.kind).toBe("wrapper");
    if (data.kind === "wrapper") {
      expect(data.children).toHaveLength(2);
      expect(data.children.map((c) => c.id)).toEqual(["p-child-a", "p-child-b"]);
      expect(data.orphanWeekItems).toEqual([]);
    }
  });

  it("treats weekItems attached to the wrapper as orphans (not as rendered rows)", () => {
    const orphanItems = [
      makeWeekItem({ id: "w-orphan-1", projectId: "p-wrap", title: "Stray Item" }),
      makeWeekItem({ id: "w-orphan-2", projectId: "p-wrap", title: "Another Stray" }),
    ];
    const data = buildRawData(subject, client, orphanItems);
    expect(data.kind).toBe("wrapper");
    if (data.kind === "wrapper") {
      expect(data.children).toHaveLength(2);
      expect(data.orphanWeekItems).toEqual([
        { id: "w-orphan-1", title: "Stray Item" },
        { id: "w-orphan-2", title: "Another Stray" },
      ]);
    }
  });

  it("strips weekItem fields beyond id+title for orphanWeekItems", () => {
    const orphan = makeWeekItem({
      id: "w-orphan",
      projectId: "p-wrap",
      title: "Stray",
      owner: "Lane",
      status: "in-progress",
    });
    const data = buildRawData(subject, client, [orphan]);
    if (data.kind === "wrapper") {
      // Only id + title carried — detector consumers don't need other fields.
      expect(data.orphanWeekItems[0]).toEqual({ id: "w-orphan", title: "Stray" });
      expect(Object.keys(data.orphanWeekItems[0]).sort()).toEqual(["id", "title"]);
    }
  });
});
