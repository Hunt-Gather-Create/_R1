/**
 * Runway Client Reference Data — Bootstrap only
 *
 * This file is used by the seed script for initial data population.
 * The bot reads client data from the database at runtime via operations-context.ts.
 * To update client data in production, use the runway:migrate runner.
 */

export interface ClientContact {
  name: string;
  role?: string;
}

export interface ClientReference {
  slug: string;
  fullName: string;
  nicknames: string[];
  contacts: ClientContact[];
}

export const CLIENT_REFERENCES: ClientReference[] = [
  {
    slug: "convergix",
    fullName: "Convergix",
    nicknames: ["CGX", "Convergix"],
    contacts: [
      { name: "Daniel", role: "Marketing Director" },
      { name: "Nicole", role: "Marketing" },
      { name: "JJ", role: "Stakeholder" },
      { name: "Bob", role: "Stakeholder" },
      { name: "Jared", role: "Stakeholder" },
      { name: "Jamie Nelson", role: "Industry Vertical" },
    ],
  },
  {
    slug: "beyond-petro",
    fullName: "Beyond Petrochemicals",
    nicknames: ["BP", "Beyond Petro", "Beyond Petrochemicals"],
    contacts: [
      { name: "Abby Compton" },
    ],
  },
  {
    slug: "lppc",
    fullName: "LPPC",
    nicknames: ["LPPC"],
    contacts: [],
  },
  {
    slug: "soundly",
    fullName: "Soundly",
    nicknames: ["Soundly"],
    contacts: [
      { name: "Josefina" },
    ],
  },
  {
    slug: "hopdoddy",
    fullName: "Hopdoddy",
    nicknames: ["Hop", "Hopdoddy"],
    contacts: [],
  },
  {
    slug: "bonterra",
    fullName: "Bonterra",
    nicknames: ["Bonterra"],
    contacts: [
      { name: "Paige", role: "Design Liaison" },
    ],
  },
  {
    slug: "hdl",
    fullName: "High Desert Law",
    nicknames: ["HDL", "High Desert", "High Desert Law"],
    contacts: [
      { name: "Chris", role: "Copywriter" },
      { name: "Jamie Lincoln", role: "Ad Words" },
    ],
  },
  {
    slug: "tap",
    fullName: "TAP",
    nicknames: ["TAP"],
    contacts: [
      { name: "Kim Sproul", role: "Client Lead" },
    ],
  },
  {
    slug: "dave-asprey",
    fullName: "Dave Asprey",
    nicknames: ["Dave", "Dave Asprey"],
    contacts: [],
  },
  {
    slug: "ag1",
    fullName: "AG1",
    nicknames: ["AG1"],
    contacts: [],
  },
  {
    slug: "edf",
    fullName: "EDF",
    nicknames: ["EDF"],
    contacts: [],
  },
  {
    slug: "wilsonart",
    fullName: "Wilsonart",
    nicknames: ["Wilsonart"],
    contacts: [],
  },
  {
    slug: "abm",
    fullName: "ABM",
    nicknames: ["ABM"],
    contacts: [],
  },
];

/** Find a client reference by slug. */
export function getClientReference(slug: string): ClientReference | undefined {
  return CLIENT_REFERENCES.find((c) => c.slug === slug);
}

/** Find a client reference by nickname (case-insensitive). */
export function findClientByNickname(nickname: string): ClientReference | undefined {
  const lower = nickname.toLowerCase();
  return CLIENT_REFERENCES.find((c) =>
    c.nicknames.some((n) => n.toLowerCase() === lower) ||
    c.fullName.toLowerCase() === lower
  );
}

/** Get contacts for a client by slug. */
export function getClientContactsRef(slug: string): ClientContact[] {
  return getClientReference(slug)?.contacts ?? [];
}
