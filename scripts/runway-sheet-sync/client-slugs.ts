/**
 * The one owner of Runway client slugs the sync knows. The sheet registry
 * and the role map both key on these, never on a typed string.
 */

export const CLIENT_SLUGS = {
  beyondPetro: "beyond-petro",
  lppc: "lppc",
  nfm: "nfm",
  soundly: "soundly",
} as const;
