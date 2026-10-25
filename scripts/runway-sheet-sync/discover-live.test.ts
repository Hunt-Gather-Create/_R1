/**
 * discoverForRun with every live input injected, and the target picking a
 * --job or --sheet run does. No Drive, ledger or database is touched.
 */
import { describe, expect, it } from "vitest";
import { discoverForRun, type DiscoveryDeps } from "./discover-live";
import { JOB_LEDGER_ENV, parseJobLedger } from "./job-ledger";
import { scheduleForJob, scheduleForSheet } from "./schedule-select";
import { driveFile, SYN_CLIENTS } from "./schedule.test-fixtures";

const JOB_HEADER = ["Job #", "Client", "Engagement", "Status", "Year", "SOW Signed", "SOW File ID", "Folder ID"];
const PREFIX_HEADER = ["Prefix", "Client Full Name", "Drive Root ID", "Active?", "Notes"];

function deps(over: Partial<DiscoveryDeps> = {}): DiscoveryDeps & { ledgerIds: string[] } {
  const ledgerIds: string[] = [];
  return {
    ledgerIds,
    readLedger: async (id) => {
      ledgerIds.push(id);
      return parseJobLedger(
        [JOB_HEADER, ["ABC-2604", "Acme Widgets", "Base Work", "live"], ["ABC-2604-02", "Acme Widgets", "Phase Two", "live"]],
        [PREFIX_HEADER],
      );
    },
    listDrive: async () => [
      driveFile("syn-base", "ABC-2604_base-work_Project-Plan-v1"),
      driveFile("syn-p2-v1", "ABC-2604-02 | Phase Two Schedule v1"),
      driveFile("syn-p2-v2", "ABC-2604-02 | Phase Two Schedule v2"),
    ],
    readClients: async () => SYN_CLIENTS,
    readOverrides: async () => [],
    ...over,
  };
}

const ENV = { [JOB_LEDGER_ENV]: "syn-ledger" };

describe("discoverForRun", () => {
  it("a missing RUNWAY_JOB_LEDGER_SHEET_ID stops the run with one plain line before any read", async () => {
    const never = async (): Promise<never> => {
      throw new Error("a read ran");
    };
    const run = discoverForRun({}, { readLedger: never, listDrive: never, readClients: never, readOverrides: never });
    await expect(run).rejects.toThrow(/^RUNWAY_JOB_LEDGER_SHEET_ID is not set[^\n]*\.$/);
  });

  it("reads the ledger the environment names", async () => {
    const d = deps();
    await discoverForRun(ENV, d);
    expect(d.ledgerIds).toEqual(["syn-ledger"]);
  });
});

describe("--job and --sheet resolve through discovery, with no registry entry in code", () => {
  it("--job ABC-2604-02 finds its newest synthetic schedule", async () => {
    const discovery = await discoverForRun(ENV, deps());
    expect(scheduleForJob(discovery, "ABC-2604-02")).toEqual({
      sheetId: "syn-p2-v2",
      clientSlug: "acme-widgets",
      engagementCode: "ABC-2604-02",
      label: "Phase Two",
    });
    expect(scheduleForJob(discovery, "abc-2604").sheetId).toBe("syn-base");
  });

  it("--job for a job not in the ledger, or with no schedule, refuses by name", async () => {
    const discovery = await discoverForRun(ENV, deps({ listDrive: async () => [driveFile("syn-base", "ABC-2604 Schedule v1")] }));
    expect(() => scheduleForJob(discovery, "ABC-2699")).toThrow("Job ABC-2699 is not in the job ledger.");
    expect(() => scheduleForJob(discovery, "ABC-2604-02")).toThrow(/Job ABC-2604-02 has no schedule in Drive/);
  });

  it("--sheet on the chosen id resolves; on a superseded id it refuses, naming the chosen one", async () => {
    const discovery = await discoverForRun(ENV, deps());
    expect(scheduleForSheet(discovery, "syn-p2-v2").engagementCode).toBe("ABC-2604-02");
    expect(() => scheduleForSheet(discovery, "syn-p2-v1")).toThrow(/syn-p2-v1.*not the latest plan for job ABC-2604-02.*syn-p2-v2/);
    expect(() => scheduleForSheet(discovery, "syn-unknown")).toThrow(/not found by schedule discovery/);
  });

  it("--sheet on a file in a refused job throws the job's refusal", async () => {
    const discovery = await discoverForRun(ENV, deps({ readClients: async () => [] }));
    expect(() => scheduleForSheet(discovery, "syn-base")).toThrow(/Job ABC-2604: client "Acme Widgets" matches no Runway client/);
  });
});
