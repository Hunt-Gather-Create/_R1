/**
 * The column J vocabulary: label words to role tags. Words only, never a
 * person; who fills a role comes from the client's Account Teams rows.
 */

/** A label word, lowercased, to the role tag it names. */
const WORD_TO_TAG: Record<string, string> = {
  design: "CD",
  creative: "CD",
  creatives: "CD",
  cd: "CD",
  dev: "Dev",
  qa: "QA",
  account: "AM",
  am: "AM",
  // A bare "Civ" beside a client label names the agency side of a handoff, its account manager.
  civ: "AM",
  motion: "Motion",
  strategy: "Strategy",
  pm: "PM",
  copy: "CW",
  cw: "CW",
};

/** team_members.roleCategory to the role tag a named person carries when the client's team does not list them. */
const CATEGORY_TO_TAG: Record<string, string> = {
  creative: "CD",
  dev: "Dev",
  am: "AM",
  pm: "PM",
  strategy: "Strategy",
  community: "CM",
};

/** Splits a column J cell into words. */
export const WORD_SEPARATORS = /[+,/]/;

export function normWord(word: string): string {
  return word.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Drops a leading "Civ " so "Civ Creative" reads as "Creative". */
export function dropCiv(word: string): string {
  return word.trim().replace(/^civ\s+/i, "").trim();
}

/** The role tag a label word names, or null when the vocabulary has no entry. */
export function roleTagForWord(word: string): string | null {
  return WORD_TO_TAG[normWord(word)] ?? null;
}

/** Every role tag the vocabulary can emit, for the resources validator check. */
export function vocabularyTags(): string[] {
  return [...new Set([...Object.values(WORD_TO_TAG), ...Object.values(CATEGORY_TO_TAG)])];
}

export function roleTagForCategory(category: string | null): string | null {
  return category ? CATEGORY_TO_TAG[normWord(category)] ?? null : null;
}
