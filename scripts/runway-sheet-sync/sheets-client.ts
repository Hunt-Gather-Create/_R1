/**
 * Service-account read path for Runway sheet-sync (M1 E1, issue #101).
 *
 * Returns the same SheetFixture shape as the fixture-file path so every
 * downstream consumer (parse-sheet, diff, ledger, payloads) is unchanged.
 * The credential is read lazily inside the function so `pnpm build` never
 * requires it — only an actual `--live` read touches GOOGLE_SERVICE_ACCOUNT_JSON.
 */
import { google } from "googleapis";
import type { SheetFixture } from "./types";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
}

export function loadServiceAccountCredentials(): ServiceAccountCreds {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is required for --live sheet reads (base64-encoded service-account key). It is missing or empty."
    );
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid base64.");
  }
  let parsed: Partial<ServiceAccountCreds>;
  try {
    parsed = JSON.parse(decoded) as Partial<ServiceAccountCreds>;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON did not decode to valid JSON.");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

export async function readSheetViaServiceAccount(
  sheetId: string,
  range: string
): Promise<SheetFixture> {
  const creds = loadServiceAccountCredentials();
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const values = (res.data.values ?? []) as (string | undefined)[][];
  const tab = range.includes("!") ? range.slice(0, range.indexOf("!")) : range;
  return {
    sheetId,
    tab,
    range,
    exportedAt: new Date().toISOString(),
    values,
  };
}
