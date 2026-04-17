/**
 * Seed data for the Runway database.
 *
 * Extracted from reference files so seed data is testable independently.
 * This is the source of truth for initial data population.
 */

import type { ClientContact } from "../src/lib/runway/reference/clients";
export type { ClientContact };

export interface TeamSeedEntry {
  name: string;
  firstName: string;
  fullName: string;
  nicknames: string[];
  title: string;
  slackUserId: string;
  roleCategory: string;
  accountsLed: string[];
  channelPurpose: string | null;
}

export const TEAM_SEED_DATA: TeamSeedEntry[] = [
  {
    name: "Kathy Horn",
    firstName: "Kathy",
    fullName: "Kathy Horn",
    nicknames: [],
    title: "Co-Founder / Executive Creative Director",
    slackUserId: "U11NL4SBS",
    roleCategory: "leadership",
    accountsLed: ["convergix"],
    channelPurpose: "Creative, copy, client relationships",
  },
  {
    name: "Jason Burks",
    firstName: "Jason",
    fullName: "Jason Burks",
    nicknames: [],
    title: "Co-Founder / Development Director",
    slackUserId: "U1HH41TFX",
    roleCategory: "leadership",
    accountsLed: ["tap"],
    channelPurpose: "Strategy, operations, account management",
  },
  {
    name: "Jill Runyon",
    firstName: "Jill",
    fullName: "Jill Runyon",
    nicknames: [],
    title: "Director of Client Experience",
    slackUserId: "U08TZ6ZDEUF",
    roleCategory: "am",
    accountsLed: ["beyond-petro", "bonterra", "ag1", "edf", "abm"],
    channelPurpose: "Beyond Petro, AM accounts",
  },
  {
    name: "Allison Shannon",
    firstName: "Allison",
    fullName: "Allison Shannon",
    nicknames: ["Allie"],
    title: "Strategy Director / Sr. Account Manager",
    slackUserId: "U06BA311N92",
    roleCategory: "am",
    accountsLed: ["wilsonart", "dave-asprey"],
    channelPurpose: "Wilsonart, AM accounts",
  },
  {
    name: "Lane Jordan",
    firstName: "Lane",
    fullName: "Lane Jordan",
    nicknames: [],
    title: "Creative Director",
    slackUserId: "U03F7MED8F8",
    roleCategory: "creative",
    accountsLed: [],
    channelPurpose: "Brand, design direction",
  },
  {
    name: "Leslie Crosby",
    firstName: "Leslie",
    fullName: "Leslie Crosby",
    nicknames: [],
    title: "Sr. Frontend Dev / Technical PM",
    slackUserId: "U01LJGMC1GV",
    roleCategory: "dev",
    accountsLed: [],
    channelPurpose: "Dev, web builds",
  },
  {
    name: "Ronan Lane",
    firstName: "Ronan",
    fullName: "Ronan Lane",
    nicknames: [],
    title: "Senior PM",
    slackUserId: "",
    roleCategory: "pm",
    accountsLed: ["hopdoddy", "lppc", "soundly"],
    channelPurpose: "Project management, status tracking",
  },
  {
    name: "Sami Blumenthal",
    firstName: "Sami",
    fullName: "Sami Blumenthal",
    nicknames: [],
    title: "Community Manager",
    slackUserId: "U0AFM4FG87P",
    roleCategory: "community",
    accountsLed: [],
    channelPurpose: "Community management",
  },
  {
    name: "Tim Warren",
    firstName: "Tim",
    fullName: "Tim Warren",
    nicknames: [],
    title: "Director of AI",
    slackUserId: "U016N17D9KR",
    roleCategory: "dev",
    accountsLed: [],
    channelPurpose: "AI, development",
  },
  {
    name: "Chris",
    firstName: "Chris",
    fullName: "Chris",
    nicknames: [],
    title: "Copywriter (HDL)",
    slackUserId: "",
    roleCategory: "contractor",
    accountsLed: [],
    channelPurpose: "HDL copy",
  },
  {
    name: "Josefina",
    firstName: "Josefina",
    fullName: "Josefina",
    nicknames: [],
    title: "Contractor (Soundly)",
    slackUserId: "",
    roleCategory: "contractor",
    accountsLed: [],
    channelPurpose: "Soundly contractor",
  },
];

/** Client nicknames by slug */
export const CLIENT_SEED_NICKNAMES: Record<string, string[]> = {
  convergix: ["CGX", "Convergix"],
  "beyond-petro": ["BP", "Beyond Petro", "Beyond Petrochemicals"],
  lppc: ["LPPC"],
  soundly: ["Soundly"],
  hopdoddy: ["Hop", "Hopdoddy"],
  bonterra: ["Bonterra"],
  hdl: ["HDL", "High Desert", "High Desert Law"],
  tap: ["TAP"],
  "dave-asprey": ["Dave", "Dave Asprey"],
  ag1: ["AG1"],
  edf: ["EDF"],
  wilsonart: ["Wilsonart"],
  abm: ["ABM"],
};

/** Client contacts by slug — structured with roles */
export const CLIENT_SEED_CONTACTS: Record<string, ClientContact[]> = {
  convergix: [
    { name: "Daniel", role: "Marketing Director" },
    { name: "Nicole", role: "Marketing" },
    { name: "JJ", role: "Stakeholder" },
    { name: "Bob", role: "Stakeholder" },
    { name: "Jared", role: "Stakeholder" },
    { name: "Jamie Nelson", role: "Industry Vertical" },
  ],
  "beyond-petro": [{ name: "Abby Compton" }],
  lppc: [],
  soundly: [{ name: "Josefina" }],
  hopdoddy: [],
  bonterra: [{ name: "Paige", role: "Design Liaison" }],
  hdl: [
    { name: "Chris", role: "Copywriter" },
    { name: "Jamie Lincoln", role: "Ad Words" },
  ],
  tap: [{ name: "Kim Sproul", role: "Client Lead" }],
  "dave-asprey": [],
  ag1: [],
  edf: [],
  wilsonart: [],
  abm: [],
};
