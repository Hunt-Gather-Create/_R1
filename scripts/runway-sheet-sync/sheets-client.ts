/**
 * Live read paths for Runway sheet-sync: the service account when its key is
 * set, otherwise the google-api skill's CLI.
 *
 * Returns the same SheetFixture shape as the fixture-file path so every
 * downstream consumer (parse-sheet, diff, ledger, payloads) is unchanged.
 * The credential is read lazily inside the function so `pnpm build` never
 * requires it — only an actual `--live` read touches GOOGLE_SERVICE_ACCOUNT_JSON.
 */
import { google } from "googleapis";
import { GOOGLE_API_CONSUMER, GoogleApiCliError, runGoogleApiCli, type GoogleApiCliOptions } from "./google-api-cli";
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
  return toFixture(sheetId, range, values);
}

function toFixture(sheetId: string, range: string, values: (string | undefined)[][]): SheetFixture {
  const tab = range.includes("!") ? range.slice(0, range.indexOf("!")) : range;
  return {
    sheetId,
    tab,
    range,
    exportedAt: new Date().toISOString(),
    values,
  };
}

/** Reads through the google-api skill's CLI; the CLI owns the credential. */
export async function readSheetViaGoogleApiCli(
  sheetId: string,
  range: string,
  opts: GoogleApiCliOptions = {}
): Promise<SheetFixture> {
  const out = (await runGoogleApiCli("sheets:read", [sheetId, range], opts)) as { values?: unknown } | null;
  if (!out || !Array.isArray(out.values)) {
    throw new GoogleApiCliError("google-api CLI sheets:read printed JSON with no values array");
  }
  return toFixture(sheetId, range, out.values as (string | undefined)[][]);
}

export type LiveSource = "service-account" | "google-api-cli";

/** A set GOOGLE_SERVICE_ACCOUNT_JSON keeps the service-account path; otherwise the CLI. */
export function chooseLiveSource(env: NodeJS.ProcessEnv = process.env): LiveSource {
  return env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ? "service-account" : "google-api-cli";
}

/** The one startup line naming the credential source. It never carries a secret. */
export function liveSourceLine(source: LiveSource): string {
  return source === "service-account"
    ? "── sheet source: service account, GOOGLE_SERVICE_ACCOUNT_JSON"
    : `── sheet source: google-api CLI as consumer ${GOOGLE_API_CONSUMER}`;
}

export async function readSheetLive(
  sheetId: string,
  range: string,
  source: LiveSource,
  opts: GoogleApiCliOptions = {}
): Promise<SheetFixture> {
  return source === "service-account"
    ? readSheetViaServiceAccount(sheetId, range)
    : readSheetViaGoogleApiCli(sheetId, range, opts);
}
