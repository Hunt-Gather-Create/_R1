/**
 * Sørensen-Dice fuzzy match utility (bigram-based).
 *
 * Extracted as a shared module per pre-plan §A2/§A3 §1: Builders 3, 8, 9, 11
 * all need caller-side fuzzy match (slash dispatcher in /api/slack/commands,
 * open_create_modal action handler in /api/slack/interactivity, modal
 * validate-submission, view_closed cancellation handler) BEFORE views.open
 * fires. Putting the math here lets route handlers import it without pulling
 * in the full validator chain from operations-utils.
 *
 * The Sørensen-Dice coefficient is the canonical "how similar are these
 * strings" measure — better than substring/startsWith for typos and
 * abbreviations ("AG1 Pro" vs "AG1 Pro Subscriber 2026"), better than
 * Levenshtein for short strings (no character-by-character edit cost). The
 * bigram set construction below counts duplicates so "Lee" vs "Leeee" doesn't
 * collide trivially.
 */

/**
 * Compute the Sørensen-Dice coefficient between two strings.
 *
 * - Lowercases and trims both inputs (whitespace at ends doesn't bias the
 *   score).
 * - For strings shorter than 2 chars, returns 1 if exactly equal, else 0
 *   (bigram overlap is undefined for length-1 strings).
 * - Returns a score in [0, 1] where 1 is identical bigram multisets.
 *
 * Implementation note: bigrams stored as Map<bigram, count> so duplicate
 * bigrams contribute correctly to both the intersection and the totals.
 */
export function sorensenDice(a: string, b: string): number {
  const A = a.toLowerCase().trim();
  const B = b.toLowerCase().trim();
  if (A.length < 2 || B.length < 2) return A === B ? 1 : 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const aBg = bigrams(A);
  const bBg = bigrams(B);
  let intersect = 0;
  for (const [bg, count] of aBg) {
    const otherCount = bBg.get(bg) ?? 0;
    intersect += Math.min(count, otherCount);
  }
  const aTotal = A.length - 1;
  const bTotal = B.length - 1;
  return (2 * intersect) / (aTotal + bTotal);
}

/**
 * Filter `candidates` to those whose `getName(c)` scores at or above
 * `threshold` against `name`. Default threshold 0.6 — empirically the lowest
 * point where "AG1 Pro" matches "AG1 Pro Subscriber 2026" while a typo of
 * "Convergix" still rules out unrelated entries. Callers that need stricter
 * matching pass a higher threshold (e.g. 0.8 for parent-picker hint copy).
 */
export function fuzzyMatchCandidates<T>(
  name: string,
  candidates: T[],
  getName: (c: T) => string,
  threshold = 0.6,
): T[] {
  return candidates.filter((c) => sorensenDice(name, getName(c)) >= threshold);
}
