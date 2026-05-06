/**
 * Shared helper for "did the user already pick an entity in disambiguation?"
 * checks across the Slack modal builders.
 *
 * Wave 1 originally inlined the predicate per modal, which drifted: task
 * checked `asString(currentValues?.title)`, project checked `currentValues?.name`,
 * and team-member walked five identifying keys. Same logical question, three
 * implementations. Wave 6 / Fix 6.2 consolidates it here so the disambiguation
 * gate stays consistent as the schema evolves.
 *
 * Civ voice rule: hyphens, not em-dashes. Plain ASCII.
 */
export type PickerEntityKind = "task" | "project" | "team-member";

/**
 * Returns true when `currentValues` already carries the entity-identifying
 * field for the given kind. Used by the modal builders to suppress the
 * multi-match candidate picker once the user has picked a row (or the slash
 * command resolved to a single match and prefilled currentValues).
 *
 * Field-per-kind contract:
 *   - task        -> currentValues.title (non-empty string)
 *   - project     -> currentValues.name (non-empty string)
 *   - team-member -> currentValues.fullName OR currentValues.name (non-empty string)
 *
 * Returns false on null / undefined currentValues so the picker renders.
 */
export function hasPickedEntity(
  currentValues: Record<string, unknown> | undefined | null,
  kind: PickerEntityKind,
): boolean {
  if (!currentValues || typeof currentValues !== "object") return false;
  const isNonEmptyString = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0;
  if (kind === "task") {
    return isNonEmptyString(currentValues.title);
  }
  if (kind === "project") {
    return isNonEmptyString(currentValues.name);
  }
  // team-member: fullName preferred; legacy rows may carry only `name`.
  return (
    isNonEmptyString(currentValues.fullName) ||
    isNonEmptyString(currentValues.name)
  );
}

/**
 * Infer the dateType ("single" | "range") an args/row bag represents. Prefers
 * an explicit `dateType` key; otherwise reads the start/end/date shape.
 * Single-mode rows mirror date into both startDate and endDate, so when all
 * three agree we treat the bag as single-mode. A row with start != end (or
 * date null while start/end set) is range-mode.
 *
 * Used both by the modal builder (to default the radio correctly when
 * opening a Range-shaped row) and by the validator (to detect a dateType
 * toggle mid-edit). Returns undefined when the bag carries no date data.
 */
export function inferDateTypeFromArgs(
  args: Record<string, unknown> | undefined | null,
): "single" | "range" | undefined {
  if (!args || typeof args !== "object") return undefined;
  const explicit = args.dateType;
  if (explicit === "single" || explicit === "range") return explicit;
  const start = typeof args.startDate === "string" ? args.startDate : "";
  const end = typeof args.endDate === "string" ? args.endDate : "";
  const date = typeof args.date === "string" ? args.date : "";
  if (date && start === date && end === date) return "single";
  if (start || end) return "range";
  if (date) return "single";
  return undefined;
}
