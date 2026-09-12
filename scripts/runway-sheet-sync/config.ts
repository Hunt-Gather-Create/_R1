/**
 * Sheet registry for Phase 1a diff runs.
 *
 * Client slugs are invocation config — never parsed from sheet banners (§2.6).
 * Engagement codes are the REAL codes; two file names carry stale codes
 * (Soundly RX file title says SND-2602, LPPC 2604-01 body says LPP-2603-01) —
 * read by content, flag drift, never rename (locked gotcha).
 */
import type { SheetConfig } from "./types";

export const SHEETS: SheetConfig[] = [
  {
    sheetId: "1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog",
    clientSlug: "beyond-petro",
    engagementCode: "BPC-2603-01",
    label: "ITEP Landing Page",
  },
  {
    sheetId: "1iK2uiKLvaxezqfW43DdMihQAwmOgV0Z8gNh7uCcbvrM",
    clientSlug: "soundly",
    engagementCode: "SND-2603",
    label: "RX Card Rebuild",
  },
  {
    sheetId: "1Ly8koIAYw2IvU_3YC4vouoVjoy8yIlVSIlsf8mfs4pg",
    clientSlug: "lppc",
    engagementCode: "LPP-2604-01",
    label: "Phase 2.1 Homepage Update + Featured Reports",
  },
  {
    sheetId: "1agy2J6fIddCjn-HNt_exxIIm1AV-ZOREEYPwr_AngmI",
    clientSlug: "lppc",
    engagementCode: "LPP-2604-02",
    label: "Website Revamp Phase 2",
  },
  {
    sheetId: "1JuPXk46yjAAav8fu7U6CEg8ILLd9TzALcmZYeGE3XOk",
    clientSlug: "beyond-petro",
    engagementCode: "BPC-2602-01",
    label: "Spilltracker Website Refresh",
  },
  {
    sheetId: "1lt-Guu94c-mBvHdNVjHLwDHP0CstxDLBOMpop1he-Cw",
    clientSlug: "beyond-petro",
    engagementCode: "BPC-2605-01",
    label: "Ammonia Landing Page",
  },
  {
    sheetId: "14x2WqepMH2iexwinkZ1mQQJY37TbSvqu1NhBqNL_dp0",
    clientSlug: "nfm",
    engagementCode: "NFM-2601",
    label: "Cedar Park Digital Screen",
  },
];

export function getSheetConfig(sheetId: string): SheetConfig | undefined {
  return SHEETS.find((s) => s.sheetId === sheetId);
}
