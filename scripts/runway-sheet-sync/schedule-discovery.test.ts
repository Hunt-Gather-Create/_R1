/**
 * Schedule discovery rules 1 to 5 over synthetic ledgers, listings, clients
 * and sheet_registry rows. No real Drive id or engagement appears here.
 */
import { describe, expect, it } from "vitest";
import { discoverSchedules, type DiscoveryInput, type JobSchedule } from "./schedule-discovery";
import { driveFile, ledgerJob, SYN_CLIENTS } from "./schedule.test-fixtures";

function discover(over: Partial<DiscoveryInput>) {
  return discoverSchedules({ jobs: [], listing: [], clients: SYN_CLIENTS, overrides: [], ...over });
}

function entryFor(jobs: JobSchedule[], jobNumber: string): JobSchedule {
  const e = jobs.find((j) => j.job.jobNumber === jobNumber);
  if (!e) throw new Error(`no entry for ${jobNumber}`);
  return e;
}

describe("rule 1: a schedule belongs to the job whose number starts its name", () => {
  const jobs = [ledgerJob("ACW-2604", "Acme Widgets", "Base Work"), ledgerJob("ACW-2604-02", "Acme Widgets", "Phase Two")];

  it("ACW-2604-02's file goes to ACW-2604-02 only, never to ACW-2604", () => {
    const d = discover({ jobs, listing: [driveFile("syn-p2", "ACW-2604-02 | Phase Two Schedule v1")] });
    expect(entryFor(d.jobs, "ACW-2604-02")).toMatchObject({ kind: "chosen", config: { sheetId: "syn-p2" } });
    expect(entryFor(d.jobs, "ACW-2604").kind).toBe("none");
  });

  it("a file belongs to the longest job number that starts its name as a whole token", () => {
    const deep = [ledgerJob("GLX-2501-03", "Globex", "Phase Three"), ledgerJob("GLX-2501-03-35", "Globex", "Sub Phase")];
    const d = discover({ jobs: deep, listing: [driveFile("syn-deep", "GLX-2501-03-35 | Sub Phase Schedule v1")] });
    expect(entryFor(d.jobs, "GLX-2501-03-35")).toMatchObject({ kind: "chosen", config: { sheetId: "syn-deep" } });
    expect(entryFor(d.jobs, "GLX-2501-03").kind).toBe("none");
  });

  it("a file that names the job later in its title belongs to no job", () => {
    const d = discover({ jobs, listing: [driveFile("syn-copy", "Copy of ACW-2604 Schedule v1")] });
    expect(entryFor(d.jobs, "ACW-2604").kind).toBe("none");
    expect(d.unowned.map((f) => f.id)).toEqual(["syn-copy"]);
  });

  it("a spreadsheet without a version marker is not a schedule", () => {
    const d = discover({ jobs, listing: [driveFile("syn-notes", "ACW-2604 meeting notes")] });
    expect(entryFor(d.jobs, "ACW-2604").kind).toBe("none");
    expect(d.unowned).toEqual([]);
  });

  it("each of the three name markers counts", () => {
    const listing = [
      driveFile("syn-a", "ACW-2604 | Base Work Schedule v1"),
      driveFile("syn-b", "ACW-2604 | Base Work - Project Plan v2"),
      driveFile("syn-c", "ACW-2604_base-work_Project-Plan-v3"),
    ];
    const e = entryFor(discover({ jobs, listing }).jobs, "ACW-2604");
    expect(e.kind === "chosen" && e.superseded.length).toBe(2);
  });
});

describe("rule 2: the highest version wins, the others are superseded by rule", () => {
  const jobs = [ledgerJob("GLX-2605", "Globex", "Launch Site")];
  const listing = [
    driveFile("syn-v1", "GLX-2605_launch-site_Project-Plan-v1"),
    driveFile("syn-v3", "GLX-2605_launch-site_Project-Plan-v3"),
    driveFile("syn-v2", "GLX-2605_launch-site_Project-Plan-v2"),
  ];

  it("v3 is chosen and v1 and v2 read superseded, whatever the listing order", () => {
    for (const order of [listing, [...listing].reverse()]) {
      const e = entryFor(discover({ jobs, listing: order }).jobs, "GLX-2605");
      expect(e.kind).toBe("chosen");
      if (e.kind !== "chosen") return;
      expect(e.config.sheetId).toBe("syn-v3");
      expect(e.superseded.map((f) => f.id).sort()).toEqual(["syn-v1", "syn-v2"]);
    }
  });

  it("the version compares as a number, so v10 beats v9", () => {
    const e = entryFor(
      discover({ jobs, listing: [driveFile("syn-9", "GLX-2605 Schedule v9"), driveFile("syn-10", "GLX-2605 Schedule v10")] }).jobs,
      "GLX-2605",
    );
    expect(e.kind === "chosen" && e.config.sheetId).toBe("syn-10");
  });
});

describe("rule 3: two files with the same name and version are a refusal", () => {
  const jobs = [ledgerJob("GLX-2606", "Globex", "Twin Plan")];

  it("neither is chosen and the reason names both ids", () => {
    const listing = [driveFile("syn-twin-a", "GLX-2606 | Twin Plan Schedule v2"), driveFile("syn-twin-b", "GLX-2606 | Twin Plan Schedule v2")];
    const e = entryFor(discover({ jobs, listing }).jobs, "GLX-2606");
    expect(e.kind).toBe("refused");
    if (e.kind !== "refused") return;
    expect(e.reason).toMatch(/GLX-2606.*syn-twin-a.*syn-twin-b/);
    expect(e.files.map((f) => f.id)).toEqual(["syn-twin-a", "syn-twin-b"]);
  });

  it("a duplicate below a newer version does not refuse the job", () => {
    const listing = [
      driveFile("syn-old-a", "GLX-2606 | Twin Plan Schedule v1"),
      driveFile("syn-old-b", "GLX-2606 | Twin Plan Schedule v1"),
      driveFile("syn-new", "GLX-2606 | Twin Plan Schedule v2"),
    ];
    const e = entryFor(discover({ jobs, listing }).jobs, "GLX-2606");
    expect(e.kind === "chosen" && e.config.sheetId).toBe("syn-new");
  });
});

describe("rule 4: the job's Client text maps to exactly one Runway client", () => {
  const listing = [driveFile("syn-c1", "ACW-2607 Schedule v1")];

  it("a nickname with a trailing s and stray case still maps, and the config carries the slug", () => {
    const e = entryFor(discover({ jobs: [ledgerJob("ACW-2607", "  aws ", "Nick Plan")], listing }).jobs, "ACW-2607");
    expect(e.kind === "chosen" && e.config.clientSlug).toBe("acme-widgets");
  });

  it("no match refuses, naming the job and the client text", () => {
    const e = entryFor(discover({ jobs: [ledgerJob("ACW-2607", "Initech", "Nick Plan")], listing }).jobs, "ACW-2607");
    expect(e.kind).toBe("refused");
    expect(e.kind === "refused" && e.reason).toMatch(/ACW-2607.*"Initech".*no Runway client/);
  });

  it("two clients matching refuses, naming both", () => {
    const clients = [...SYN_CLIENTS, { slug: "acme-widget-co", name: "Acme Widget", nicknames: null }];
    const e = entryFor(discover({ jobs: [ledgerJob("ACW-2607", "Acme Widgets", "Nick Plan")], listing, clients }).jobs, "ACW-2607");
    expect(e.kind === "refused" && e.reason).toMatch(/ACW-2607.*2 Runway clients.*acme-widgets.*acme-widget-co/);
  });
});

describe("rule 5: a sheet_registry row's sheet wins over discovery", () => {
  const jobs = [ledgerJob("GLX-2608", "Globex", "Pinned Plan")];
  const listing = [driveFile("syn-pin-v1", "GLX-2601 | Old Label Schedule v1"), driveFile("syn-pin-v4", "GLX-2608 Schedule v4")];

  it("the row's sheet is chosen, marked fromRegistry, and the newest file reads superseded", () => {
    const d = discover({ jobs, listing, overrides: [{ engagementKey: "glx-2608", currentSheetId: "syn-pin-v1" }] });
    const e = entryFor(d.jobs, "GLX-2608");
    expect(e.kind).toBe("chosen");
    if (e.kind !== "chosen") return;
    expect(e.config).toMatchObject({ sheetId: "syn-pin-v1", fromRegistry: true });
    expect(e.file?.name).toBe("GLX-2601 | Old Label Schedule v1");
    expect(e.superseded.map((f) => f.id)).toEqual(["syn-pin-v4"]);
    expect(d.unowned).toEqual([]);
  });

  it("without the row, discovery picks the newest file and nothing is marked fromRegistry", () => {
    const e = entryFor(discover({ jobs, listing }).jobs, "GLX-2608");
    expect(e.kind === "chosen" && e.config).toEqual({
      sheetId: "syn-pin-v4",
      clientSlug: "globex",
      engagementCode: "GLX-2608",
      label: "Pinned Plan",
    });
  });

  it("a row for a job with no Drive file still chooses the row's sheet", () => {
    const d = discover({ jobs, listing: [], overrides: [{ engagementKey: "GLX-2608", currentSheetId: "syn-elsewhere" }] });
    const e = entryFor(d.jobs, "GLX-2608");
    expect(e.kind === "chosen" && e.config.sheetId).toBe("syn-elsewhere");
  });
});
