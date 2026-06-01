/**
 * Client-safe parser + serializer for the dashboard edit modal's resource
 * chip editor (#70 commit 8a). The canonical parser in `operations-utils.ts`
 * transitively imports `node:async_hooks` via `runway-als.ts` and can't ride
 * into a "use client" bundle; this module is a tighter slice that only
 * handles the flat operator-locked "Role: Name, Role: Name" form.
 *
 * Arrow-sequence + concurrent-stage parsing stays server-side via
 * `parseResources` — when the chip editor sees an existing value that
 * uses those advanced forms, it falls back to free-text editing so we
 * don't silently collapse data the editor can't faithfully round-trip.
 *
 * Canonical role list per `feedback_naming_and_field_conventions.md`:
 * AM, CD, Dev, CW, PM, CM, Strat.
 */

export const ROLE_TAGS = [
  "AM",
  "CD",
  "Dev",
  "CW",
  "PM",
  "CM",
  "Strat",
] as const;

export type RoleTag = (typeof ROLE_TAGS)[number];

export type ResourceChip = {
  role: string;
  name: string;
};

/**
 * Parse a resources string into chips. Returns an empty list when the input
 * is null/empty, contains an arrow sequence (`->` or `→`), any entry lacks
 * a role prefix, or any entry uses a role outside the canonical
 * `ROLE_TAGS` set. The caller treats empty-return-from-non-empty-input as
 * "fall back to free-text mode" — operator sees the raw string in a
 * textarea so they can fix non-canonical roles by hand before chip mode
 * unlocks.
 *
 * Non-canonical role rejection (P1.4, TP code-review on 856b7dd): without
 * this guard, the chip <select> coerces display to "AM" when the parsed
 * role isn't in ROLE_TAGS but state.role keeps the original string —
 * serialize-on-save would silently emit the original (non-canonical) role.
 * Falling back to textarea is the operator's chance to see + fix it.
 */
const ROLE_TAG_SET: ReadonlySet<string> = new Set(ROLE_TAGS);

export function parseResourceChips(
  raw: string | null | undefined,
): ResourceChip[] {
  if (raw == null) return [];
  const trimmed = raw.trim();
  if (trimmed === "") return [];

  // Arrow sequences are the advanced form; chip editor can't represent them.
  if (/->|→|⟶|⇒|⇨/.test(trimmed)) return [];

  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return [];

  const chips: ResourceChip[] = [];
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) return []; // untagged entry → caller falls back
    const role = part.slice(0, colonIdx).trim();
    const name = part.slice(colonIdx + 1).trim();
    if (!role) return [];
    if (!ROLE_TAG_SET.has(role)) return []; // non-canonical → caller falls back
    chips.push({ role, name });
  }
  return chips;
}

/**
 * Serialize chips back to the operator-locked "Role: Name, Role: Name"
 * string. Chips with an empty name are dropped so an in-progress add-chip
 * row doesn't leak a trailing "Role: " into the save value.
 */
export function serializeResourceChips(chips: ResourceChip[]): string {
  return chips
    .map((c) => ({ role: c.role.trim(), name: c.name.trim() }))
    .filter((c) => c.name !== "")
    .map((c) => `${c.role}: ${c.name}`)
    .join(", ");
}
