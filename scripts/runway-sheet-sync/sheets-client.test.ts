import { beforeEach, describe, expect, it, vi } from "vitest";

const valuesGet = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn() },
    sheets: () => ({ spreadsheets: { values: { get: valuesGet } } }),
  },
}));

import { readSheetViaServiceAccount } from "./sheets-client";
import type { SheetFixture } from "./types";

const FAKE_CRED = Buffer.from(
  JSON.stringify({
    client_email: "svc@proj.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
  })
).toString("base64");

beforeEach(() => {
  valuesGet.mockReset();
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = FAKE_CRED;
});

describe("readSheetViaServiceAccount", () => {
  it("returns a SheetFixture whose shape matches the fixture-file path exactly", async () => {
    valuesGet.mockResolvedValue({ data: { values: [["a", "b"], ["c"]] } });
    const fx = await readSheetViaServiceAccount("sheet-123", "Task Tracker & Gantt Chart!A1:N");
    // A fixture-file SheetFixture for reference (same keys/types):
    const fixtureFileShape: SheetFixture = {
      sheetId: "sheet-123",
      tab: "Task Tracker & Gantt Chart",
      range: "Task Tracker & Gantt Chart!A1:N",
      exportedAt: "2026-01-01T00:00:00Z",
      values: [["a", "b"], ["c"]],
    };
    expect(Object.keys(fx).sort()).toEqual(Object.keys(fixtureFileShape).sort());
    expect(fx.sheetId).toBe("sheet-123");
    expect(fx.tab).toBe("Task Tracker & Gantt Chart");
    expect(fx.range).toBe("Task Tracker & Gantt Chart!A1:N");
    expect(fx.values).toEqual([["a", "b"], ["c"]]);
    expect(typeof fx.exportedAt).toBe("string");
    expect(valuesGet).toHaveBeenCalledWith({
      spreadsheetId: "sheet-123",
      range: "Task Tracker & Gantt Chart!A1:N",
    });
  });

  it("throws a clear error when GOOGLE_SERVICE_ACCOUNT_JSON is missing (non-vacuity)", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    await expect(readSheetViaServiceAccount("sheet-123", "A1:N")).rejects.toThrow(
      /GOOGLE_SERVICE_ACCOUNT_JSON is required/
    );
  });

  it("defaults missing API values to an empty array (no silent crash)", async () => {
    valuesGet.mockResolvedValue({ data: {} });
    const fx = await readSheetViaServiceAccount("s", "Tab!A1:N");
    expect(fx.values).toEqual([]);
  });
});
