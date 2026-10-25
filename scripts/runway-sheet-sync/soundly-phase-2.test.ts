/**
 * The Soundly Pre-Purchase Phase 2 schedule: its registry entry, its title
 * code, and its place in coverage. Synthetic listings only, no Drive call.
 */
import { describe, expect, it } from "vitest";
import { getSheetConfig, SHEETS } from "./config";
import { buildCoverage } from "./coverage";
import { COVERAGE_EXCLUSIONS } from "./coverage-exclusions";
import type { DriveFile } from "./discovery";
import { checkTitleCode } from "./title-code-check";

const PHASE_2 = "1K3nJwAO6DaFmcJYwFsGPOZZWMCh9rf8CvudnBQfvCF8";
const V1_SERIAL = "1xwos_75MXjkg4E724KHz_NnYVf4gOkR0kjrjEuGL_Cw";
const V2 = "1u9USwJk_AkKBNjjrnkLnz6gG0qF-z6Yv08sZDs50Wcw";

const file = (id: string, name: string): DriveFile => ({ id, name, modifiedTime: "2026-10-24T00:00:00.000Z" });

const listing: DriveFile[] = [
  file(PHASE_2, "SND-2604-02 | Pre-Purchase Phase 2 | Schedule v3"),
  file(V1_SERIAL, "SND-2604-02 | Pre-Purchase Phase 2 | Schedule v1 serial"),
  file(V2, "SND-2604-02 | Pre-Purchase Phase 2 | Schedule v2"),
];

const coverage = () =>
  buildCoverage({ listing, registry: SHEETS, exclusions: COVERAGE_EXCLUSIONS, readReport: () => ({ kind: "none" }) });

describe("Soundly Pre-Purchase Phase 2 registration", () => {
  it("is in the registry with its client, code, label and slug", () => {
    expect(getSheetConfig(PHASE_2)).toEqual({
      sheetId: PHASE_2,
      clientSlug: "soundly",
      engagementCode: "SND-2604-02",
      label: "Pre-Purchase Phase 2",
      planSlug: "pre-purchase-phase-2",
    });
  });

  it("agrees with its Drive file name's title code, with no exception", () => {
    const config = getSheetConfig(PHASE_2)!;
    expect(config.acceptedTitleCodes).toBeUndefined();
    expect(checkTitleCode(config, listing)).toBeNull();
  });
});

describe("Phase 2 schedules in coverage", () => {
  it("counts the registered Schedule v3 file in the denominator", () => {
    const result = coverage();
    expect(result.driveTotal).toBe(3);
    expect(result.rows.find((r) => r.sheetId === PHASE_2)?.label).toBe("FAILED");
    expect(result.percent).toBe(0);
  });

  it("reads the two older Phase 2 schedules as EXCLUDED, superseded by v3", () => {
    const result = coverage();
    for (const id of [V1_SERIAL, V2]) {
      const row = result.rows.find((r) => r.sheetId === id);
      expect(row?.label).toBe("EXCLUDED");
      expect(row?.detail).toMatch(/^Superseded by v3\. .*SND-2604-02 \| Pre-Purchase Phase 2 \| Schedule v3, is the registered sheet\./);
    }
    expect(result.counts.missing).toBe(0);
  });
});
