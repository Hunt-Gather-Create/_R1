/**
 * Maps a job ledger Client cell to one Runway client by name or nickname.
 * Zero matches or more than one is a refusal, never a guess.
 */

export interface RunwayClient {
  slug: string;
  name: string;
  /** JSON array of strings, as the clients table stores it. */
  nicknames: string | null;
}

export type ClientMatch = { slug: string } | { error: string };

/** Trimmed, lowercased, with one trailing "s" dropped. */
export function normalizeClientName(text: string): string {
  const t = text.trim().toLowerCase();
  return t.endsWith("s") ? t.slice(0, -1) : t;
}

function namesOf(client: RunwayClient): string[] {
  if (!client.nicknames) return [client.name];
  let parsed: unknown;
  try {
    parsed = JSON.parse(client.nicknames);
  } catch {
    throw new Error(`Runway client ${client.slug} has nicknames that are not a JSON array.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`Runway client ${client.slug} has nicknames that are not a JSON array.`);
  return [client.name, ...parsed.filter((n): n is string => typeof n === "string")];
}

export function matchClient(jobNumber: string, clientText: string, clients: RunwayClient[]): ClientMatch {
  const wanted = normalizeClientName(clientText);
  const slugs = wanted
    ? [...new Set(clients.filter((c) => namesOf(c).some((n) => normalizeClientName(n) === wanted)).map((c) => c.slug))]
    : [];
  if (slugs.length === 1) return { slug: slugs[0] };
  const found = slugs.length === 0 ? "no Runway client" : `${slugs.length} Runway clients, ${slugs.join(", ")}`;
  return {
    error: `Job ${jobNumber}: client "${clientText}" matches ${found} by name or nickname, so the job is refused.`,
  };
}
