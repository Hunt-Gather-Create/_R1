/**
 * Drive plan sheets that are not meant to sync, each with a written reason a
 * person can read and disagree with. The coverage output lists every entry;
 * none is dropped before the count.
 */
export interface CoverageExclusion {
  sheetId: string;
  /** The Drive file name when the exclusion was written. */
  name: string;
  reason: string;
}

export const COVERAGE_EXCLUSIONS: CoverageExclusion[] = [
  {
    sheetId: "1-syqdrB4ujhN1j7LZ-zy1biUOMUgyF_5501j-fRJ5FE",
    name: "BPC-2602_spilltracker_Project-Plan-v1",
    reason: "Superseded v1. The v2 plan, BPC-2602_spilltracker_Project-Plan-v2, is the registered sheet.",
  },
  {
    sheetId: "1RToqJQ8NvR4PARRI0B2YmpeGePhb5-oOKaIiqw3TlYc",
    name: "BPC-2605_ammonia_Project-Plan-v1",
    reason: "Superseded v1. The v2 plan, BPC-2605_ammonia_Project-Plan-v2, is the registered sheet.",
  },
  {
    sheetId: "1giFx_-ewRrX-vpDxsNWUWBxxWlpBh_wtu0C-Jtu6sWs",
    name: "NFM-2601_cedar-park-digital-screen_Project-Plan-v1",
    reason:
      "A second Drive file with the same name as the registered NFM plan; the registered sheet is 14x2WqepMH2iexwinkZ1mQQJY37TbSvqu1NhBqNL_dp0.",
  },
];
