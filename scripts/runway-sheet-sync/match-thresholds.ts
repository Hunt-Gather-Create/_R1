/** Title similarity floors shared by the L1 resolvers and the row matcher. */

/** Accept as the same task at/above this similarity. */
export const WI_MATCH_THRESHOLD = 0.75;
/** Mention as a near-miss candidate at/above this similarity. */
export const WI_CANDIDATE_THRESHOLD = 0.55;

/** Same two floors, applied to week-item-carry's title-vs-WI-title score. */
export const CARRY_MATCH_THRESHOLD = 0.75;
export const CARRY_CANDIDATE_THRESHOLD = 0.55;
