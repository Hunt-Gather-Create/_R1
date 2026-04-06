/**
 * Shared test fixtures for RunwayBoard component tests.
 */

import type { DayItem, Account, PipelineItem } from "./types";

export const thisWeek: DayItem[] = [
  {
    date: "2026-04-06",
    label: "Mon 4/6",
    items: [
      { title: "CDS Review", account: "Convergix", type: "review" },
    ],
  },
  {
    date: "2026-04-07",
    label: "Tue 4/7",
    items: [
      { title: "LPPC Kickoff", account: "LPPC", owner: "Kathy", type: "kickoff" },
    ],
  },
];

export const upcoming: DayItem[] = [
  {
    date: "2026-04-13",
    label: "Mon 4/13",
    items: [{ title: "Future Item", account: "Test Co", type: "delivery" }],
  },
];

export const accounts: Account[] = [
  {
    name: "Convergix",
    slug: "convergix",
    contractStatus: "signed",
    contractValue: "$120,000",
    contractTerm: "Annual",
    items: [
      {
        id: "p1",
        title: "CDS Messaging",
        status: "in-production",
        category: "active",
        owner: "Kathy",
      },
    ],
  },
];

export const pipeline: PipelineItem[] = [
  {
    account: "Convergix",
    title: "New SOW",
    value: "$50,000",
    status: "sow-sent",
    waitingOn: "Daniel",
  },
];
