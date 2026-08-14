import { existsSync, readFileSync } from "fs";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writePreSnapshot, postVerifyDiff } from "./snapshot";
import type { RunwayClientBundle } from "./runway-read";

function makeBundle(overrides: Partial<RunwayClientBundle> = {}): RunwayClientBundle {
  return {
    client: { id: "c1", slug: "test-client", name: "Test Client" },
    projects: [
      { id: "p1", name: "Project One", status: "active", category: "design", notes: null },
      { id: "p2", name: "Project Two", status: "active", category: "dev", notes: null },
    ],
    weekItems: [
      {
        id: "wi1",
        projectId: "p1",
        title: "Week Item One",
        weekOf: "2026-08-11",
        startDate: null,
        endDate: null,
        status: "in-progress",
        category: null,
        notes: null,
      },
      {
        id: "wi2",
        projectId: "p2",
        title: "Week Item Two",
        weekOf: "2026-08-11",
        startDate: null,
        endDate: null,
        status: "not-started",
        category: null,
        notes: null,
      },
    ],
    ...overrides,
  };
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "e3-snap-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true });
});

describe("writePreSnapshot", () => {
  it("writes <runId>-pre.json and the content round-trips to the bundle", () => {
    const bundle = makeBundle();
    const runId = "run-pre-001";
    const filePath = writePreSnapshot(bundle, runId, tmpDir);

    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toBe(join(tmpDir, `${runId}-pre.json`));

    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as RunwayClientBundle;
    expect(parsed).toEqual(bundle);
  });
});

describe("postVerifyDiff", () => {
  it("returns empty arrays when bundles are identical and still writes the diff file", () => {
    const bundle = makeBundle();
    const runId = "run-diff-identical";
    const diff = postVerifyDiff(bundle, bundle, runId, tmpDir);

    expect(diff.weekItems).toEqual([]);
    expect(diff.projects).toEqual([]);

    const diffPath = join(tmpDir, `${runId}-post-diff.json`);
    expect(existsSync(diffPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(diffPath, "utf-8")) as typeof diff;
    expect(parsed.weekItems).toEqual([]);
    expect(parsed.projects).toEqual([]);
  });

  it("detects a changed weekItem and returns it with before/after, nothing in projects", () => {
    const pre = makeBundle();
    const post = makeBundle({
      weekItems: [
        { ...pre.weekItems[0], title: "Updated Title" },
        pre.weekItems[1],
      ],
    });

    const runId = "run-diff-wi-change";
    const diff = postVerifyDiff(pre, post, runId, tmpDir);

    expect(diff.projects).toEqual([]);
    expect(diff.weekItems).toHaveLength(1);
    expect(diff.weekItems[0].id).toBe("wi1");
    expect((diff.weekItems[0].before as RunwayClientBundle["weekItems"][0]).title).toBe("Week Item One");
    expect((diff.weekItems[0].after as RunwayClientBundle["weekItems"][0]).title).toBe("Updated Title");

    const diffPath = join(tmpDir, `${runId}-post-diff.json`);
    expect(existsSync(diffPath)).toBe(true);
  });

  it("detects a changed project status and returns it in projects, nothing in weekItems", () => {
    const pre = makeBundle();
    const post = makeBundle({
      projects: [
        { ...pre.projects[0], status: "completed" },
        pre.projects[1],
      ],
    });

    const runId = "run-diff-proj-change";
    const diff = postVerifyDiff(pre, post, runId, tmpDir);

    expect(diff.weekItems).toEqual([]);
    expect(diff.projects).toHaveLength(1);
    expect(diff.projects[0].id).toBe("p1");
    expect((diff.projects[0].before as RunwayClientBundle["projects"][0]).status).toBe("active");
    expect((diff.projects[0].after as RunwayClientBundle["projects"][0]).status).toBe("completed");

    const diffPath = join(tmpDir, `${runId}-post-diff.json`);
    expect(existsSync(diffPath)).toBe(true);
  });
});
