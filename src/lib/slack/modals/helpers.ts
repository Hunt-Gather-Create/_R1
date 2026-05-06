/**
 * Shared modal-builder helpers.
 *
 * Pulled out of task.ts / project.ts / team-member.ts where these 7 helpers
 * were copy-pasted byte-for-byte. Centralizing them here so future text /
 * option-shape tweaks land in one place. Pure functions, no side effects.
 *
 * Civ voice rule: hyphens, not em-dashes. Plain ASCII.
 */

export function plainText(text: string, emoji = true) {
  return { type: "plain_text" as const, text, emoji };
}

export function mrkdwn(text: string) {
  return { type: "mrkdwn" as const, text };
}

/**
 * Truncate `s` to fit within `max` chars by appending " ... ". Used to keep
 * Slack modal titles under the 24-char hard cap (`views.open` rejects longer
 * titles). When `max <= 3`, falls back to a hard slice with no ellipsis.
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, max);
  return `${s.slice(0, max - 3)}...`;
}

/**
 * Coerce `v` to a non-empty string or return undefined. Used to read
 * currentValues entries safely when the field may be null / wrong-typed.
 */
export function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Coerce `v` to a non-empty string array or return undefined. Drops non-string
 * elements; returns undefined for empty arrays so callers can pass-through
 * `?? []` defaults.
 */
export function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

/**
 * Look up the option whose `value` matches `v`. Returns undefined when v is
 * empty or no option matches. Used to resolve `initial_option` from a stored
 * column value against a static option list.
 */
export function findOption(
  options: ReadonlyArray<{ value: string; label: string }>,
  v: string | undefined,
): { value: string; label: string } | undefined {
  if (!v) return undefined;
  return options.find((o) => o.value === v);
}

/**
 * Wrap a `{value, label}` pair as a Slack static_select / radio_buttons
 * option object: `{text: plainText(label), value}`.
 */
export function staticOption(o: { value: string; label: string }) {
  return { text: plainText(o.label), value: o.value };
}
