/**
 * Runway seed data — typed exports consumed by scripts/seed-runway.ts
 *
 * Source: sources/triage/runway-data.md (Kathy session Apr 3, Jill intake Apr 6)
 * Note: Original source had dates off by one for week of 4/6. Corrected here.
 */

// ── Types for seed data ──────────────────────────────────

export interface AccountData {
  name: string;
  slug: string;
  contractValue?: string;
  contractTerm?: string;
  contractStatus: "signed" | "unsigned" | "expired";
  team?: string;
  items: {
    title: string;
    status: string;
    category: string;
    owner?: string;
    waitingOn?: string;
    target?: string;
    notes?: string;
    staleDays?: number;
  }[];
}

export interface WeekDayData {
  date: string; // YYYY-MM-DD
  items: {
    title: string;
    account: string;
    owner?: string;
    resources?: string;
    type: string;
    notes?: string;
  }[];
}

export interface PipelineData {
  account: string;
  title: string;
  value: string;
  status: string;
  owner?: string;
  waitingOn?: string;
  notes?: string;
}

// ── Accounts ─────────────────────────────────────────────

export const accounts: AccountData[] = [
  {
    name: "Convergix",
    slug: "convergix",
    contractValue: "$100,000",
    contractTerm: "Feb 1 – Jul 31, 2026",
    contractStatus: "signed",
    team: "CD: Lane, Copy: Kathy, Design: Roz, Dev: Leslie, PM: Ronan",
    items: [
      { title: "CDS Messaging & Pillars R1", status: "in-production", category: "active", owner: "Kathy/Lane", target: "R1 to Daniel 4/7", notes: "Gate for all CDS content pieces" },
      { title: "CDS Creative Wrapper R1", status: "in-production", category: "active", owner: "Roz/Lane", target: "On track ~4/6-4/7", notes: "Independent track from messaging" },
      { title: "CDS Social Posts (5)", status: "not-started", category: "active", target: "KO ~4/21, delivery ~5/12", notes: "Blocked by messaging approval" },
      { title: "CDS Landing Page", status: "not-started", category: "active", target: "KO ~4/25, launch ~6/10", notes: "Blocked by messaging approval" },
      { title: "CDS Case Study + Brochure", status: "not-started", category: "active", target: "KO ~5/5, delivery ~6/12", notes: "Blocked by messaging approval" },
      { title: "New Capacity (PPT, brochure, one-pager)", status: "in-production", category: "active", owner: "Roz/Lane", target: "Revisions Mon 4/7, deliver Tues 4/8", notes: "2 slides left. Just got JJ feedback." },
      { title: "Fanuc Award Article + LI Post", status: "not-started", category: "active", owner: "Lane/Kathy", target: "Enters schedule w/o 4/20, event 4/28", notes: "Keep off plate until 4/20. Sales Excellence Award, Fanuc photo op 4/28." },
      { title: "Events Page Updates (5 tradeshows)", status: "not-started", category: "active", owner: "Kathy/Leslie", target: "Kathy starts Mon 4/7, to Leslie by Wed 4/9", notes: "AIST (May), AUTOMATE (Jun), Med Tech Ireland (Sep), PackExpo (Oct), Automation Fair (Nov)" },
      { title: "Rockwell PartnerNetwork Article", status: "awaiting-client", category: "awaiting-client", waitingOn: "Daniel", notes: "Sent 4/2, asked for feedback by 4/3", staleDays: 4 },
      { title: "Texas Instruments Article", status: "awaiting-client", category: "awaiting-client", waitingOn: "Daniel", notes: "Copy doc sent 4/2", staleDays: 4 },
      { title: "Social Content (12 posts/mo)", status: "in-production", category: "active", owner: "Roz/Ronan", notes: "Full April copy went to creative, designs back Wed for Thu status" },
      { title: "Brand Guide v2 (secondary palette)", status: "blocked", category: "active", owner: "Lane", notes: "Blocked until New Capacity finalizes (4/8)" },
      { title: "Certifications Page", status: "not-started", category: "active", waitingOn: "Daniel", notes: "Pending kickoff. Daniel to share info." },
      { title: "Corporate PPT", status: "not-started", category: "active", waitingOn: "Daniel", notes: "Pending kickoff. Daniel to share certification info." },
      { title: "Industry Vertical Campaigns", status: "not-started", category: "active", notes: "CDS vertical + Industrial/Battery Assembly. Connect with Jamie Nelson. Stakeholders: Bob, Jared." },
      { title: "Corporate Overview Brochure", status: "awaiting-client", category: "awaiting-client", waitingOn: "Daniel", staleDays: 60 },
      { title: "Life Sciences Brochure", status: "awaiting-client", category: "awaiting-client", waitingOn: "Nicole", staleDays: 60 },
      { title: "Social Media Templates", status: "awaiting-client", category: "awaiting-client", waitingOn: "Daniel/Nicole", staleDays: 18 },
      { title: "Organic Social Playbook", status: "awaiting-client", category: "awaiting-client", waitingOn: "Daniel/Nicole", staleDays: 18 },
    ],
  },
  {
    name: "LPPC",
    slug: "lppc",
    contractValue: "$59,000",
    contractTerm: "Feb 20 – May 31, 2026",
    contractStatus: "signed",
    team: "CD: Lane, Copy: Kathy, Design: Roz, Dev: Leslie, PM: Ronan",
    items: [
      { title: "Interactive Map", status: "in-production", category: "active", owner: "Roz/Leslie", target: "R2 next week, launch w/o 5/4", notes: "R1 presented 4/2, minor feedback" },
      { title: "Website Refresh — Homepage + Private Use", status: "in-production", category: "active", owner: "Roz/Leslie", notes: "Design presented 4/3, dev can start" },
      { title: "Website Refresh — Permitting Reform", status: "awaiting-client", category: "awaiting-client", waitingOn: "LPPC", notes: "Copy expected Mon/Tues 4/7-4/8" },
      { title: "Website Refresh — FEMA", status: "awaiting-client", category: "awaiting-client", waitingOn: "LPPC", notes: "Copy expected Mon/Tues 4/7-4/8" },
      { title: "Website Refresh — Launch", status: "not-started", category: "active", target: "w/o 5/4", notes: "Two launches together (map + site) would be clean" },
      { title: "Year End Report", status: "completed", category: "completed", notes: "Done. Charged for printing." },
      { title: "Spring CEO Meeting Invite", status: "completed", category: "completed", notes: "Sent." },
      { title: "Additional Website Posts", status: "not-started", category: "on-hold", notes: "Hours redirected from YER. No timeline." },
      { title: "MyLPPC Training Video", status: "on-hold", category: "on-hold", notes: "Blocked on PDF guide update from LPPC" },
      { title: "Mailchimp Invites (Spring + Fall)", status: "on-hold", category: "on-hold" },
    ],
  },
  {
    name: "Beyond Petrochemicals",
    slug: "beyond-petro",
    contractValue: "$93,000",
    contractTerm: "Jan 1 – Jun 30, 2026",
    contractStatus: "signed",
    team: "Jill Runyon, Ronan Lane",
    items: [
      { title: "Organic Social + Playbook", status: "in-production", category: "active", notes: "Monthly posts, playbook in development" },
      { title: "Plastic Additives LinkedIn Post", status: "in-production", category: "active", notes: "Tied to NYU study + Plastic Detox Netflix" },
      { title: "Fact Sheets", status: "in-production", category: "active", notes: "Branded template done, Using Strong Infrastructure done" },
      { title: "beyondpetrochemicals.org maintenance", status: "in-production", category: "active", notes: "Monthly creative/copy/dev updates per MSA" },
      { title: "spilltracker.org maintenance", status: "in-production", category: "active", notes: "Monthly maintenance per MSA" },
      { title: "Email Templates + Playbook", status: "not-started", category: "active", notes: "In MSA scope. Status unknown." },
      { title: "Strategic Initiatives", status: "not-started", category: "awaiting-client", waitingOn: "Beyond Petro", notes: "Pending definition from meeting" },
      { title: "Hopkins Research (data viz)", status: "awaiting-client", category: "awaiting-client", waitingOn: "BP/researcher", notes: "Research not submitted. Paper mid-summer." },
      { title: "Know Your Neighbor", status: "on-hold", category: "on-hold", waitingOn: "BP", notes: "June SOW timeframe" },
    ],
  },
  {
    name: "Soundly",
    slug: "soundly",
    contractValue: "$41,600",
    contractTerm: "Sep 2025 – Aug 2026",
    contractStatus: "signed",
    items: [
      { title: "iFrame Provider Search", status: "in-production", category: "active", owner: "Leslie", target: "Launch evening 4/21, live 4/22", notes: "90% done, waiting on UHG iframe testing" },
      { title: "Payment Gateway Page", status: "in-production", category: "active", owner: "Leslie", notes: "Under signed $30K SOW, through May 2026" },
      { title: "AARP Member Login + Landing Page", status: "not-started", category: "active", owner: "Josefina/Roz/Ronan/Lane", notes: "NOT STARTING until SOW signed. Launch 7/15. HIGH PRIORITY: contractor can't be held indefinitely." },
    ],
  },
  {
    name: "Hopdoddy",
    slug: "hopdoddy",
    contractValue: "$38,000",
    contractTerm: "Jan – Dec 2026",
    contractStatus: "signed",
    items: [
      { title: "Brand Refresh Website", status: "in-production", category: "active", owner: "Leslie", target: "End of April — National Burger Day", notes: "Design done, holding for launch" },
      { title: "Digital Retainer (195 hrs)", status: "in-production", category: "active", notes: "Current burn unknown. Check with Ronan." },
    ],
  },
  {
    name: "Bonterra",
    slug: "bonterra",
    contractValue: "$55,000",
    contractTerm: "Jan 5 – May 11, 2026",
    contractStatus: "unsigned",
    items: [
      { title: "Brand Refresh", status: "in-production", category: "active", notes: "In creative, coming out next week maybe" },
      { title: "Impact Report — Design", status: "in-production", category: "active", owner: "Paige", target: "4/8 Paige presents, 4/10 approval needed", notes: "Paige presenting designs 4/8. Bonterra approval by 4/10." },
      { title: "Impact Report — Dev", status: "in-production", category: "active", owner: "Leslie", target: "4/10-4/22 dev window, HARD DEADLINE 4/23", notes: "Client 3 weeks late on content. Compressed timeline." },
      { title: "Impact Report — Publish", status: "not-started", category: "active", target: "5/11", notes: "Tight given the compression" },
    ],
  },
  {
    name: "High Desert Law",
    slug: "hdl",
    contractValue: "$73,000",
    contractTerm: "Aug 22, 2025 – Jan 31, 2026",
    contractStatus: "expired",
    items: [
      { title: "Home Page Design", status: "completed", category: "completed", notes: "Done 2/25" },
      { title: "Site Copy", status: "in-production", category: "active", waitingOn: "Chris (copywriter)", notes: "Due 3/26, late. Chris blocker." },
      { title: "Site Copy Review", status: "not-started", category: "active", waitingOn: "HDL", target: "4/8", notes: "HDL to review" },
      { title: "Full Site Design", status: "not-started", category: "active", target: "4/15", notes: "Civilization delivers" },
      { title: "Full Site Design Approval", status: "not-started", category: "awaiting-client", waitingOn: "HDL", target: "4/22", notes: "Copy revisions to move to dev" },
      { title: "Photo Shoot Prep", status: "not-started", category: "active", target: "4/15", notes: "Production book + shot list" },
      { title: "Start Development", status: "not-started", category: "active", target: "5/1", notes: "After design approval" },
      { title: "Schema/SEO/AIO", status: "not-started", category: "active" },
      { title: "Ad Words", status: "not-started", category: "active", notes: "Jamie Lincoln (HDL side)" },
      { title: "Smokeball Integration", status: "not-started", category: "active", notes: "Lead capture, form fields" },
      { title: "Domain/URL + Webflow", status: "not-started", category: "active" },
      { title: "Site Staging", status: "not-started", category: "active", notes: "Publish pages as complete" },
      { title: "Production Shoot", status: "not-started", category: "active", target: "May", notes: "Client can't do shoot until May" },
      { title: "Site Live", status: "not-started", category: "active", target: "6/30" },
    ],
  },
  {
    name: "TAP",
    slug: "tap",
    contractTerm: "Mar 1 – Nov 30, 2026",
    contractStatus: "signed",
    team: "Jason (lead), Tim (requirements)",
    items: [
      { title: "Discovery Session (3 days onsite)", status: "completed", category: "completed", owner: "Jason/Tim", notes: "Mount Pleasant, TN. Mid-March." },
      { title: "Requirements Doc (SRD)", status: "in-production", category: "active", owner: "Tim/Jason", target: "Tue 4/7", notes: "Tim merging two versions into final for client" },
      { title: "Travel Invoice ($2,723 actuals)", status: "not-started", category: "active", owner: "Allie", target: "Mon 4/6", notes: "Jason approved, Allie to send" },
      { title: "TAP Reviews SRD + Greenlights", status: "not-started", category: "awaiting-client", waitingOn: "Kim Sproul", target: "After 4/7", notes: "Expect approval, scope unchanged" },
      { title: "Database Design & Architecture", status: "not-started", category: "active", target: "Late March–Mid-April", notes: "2-3 weeks post-discovery" },
      { title: "Development (8 modules)", status: "not-started", category: "active", target: "Mid-April–Mid-August", notes: "Iterative, module by module" },
      { title: "Data Migration", status: "not-started", category: "active", target: "Mid-Aug–Late Aug", notes: "Access 97 to PostgreSQL" },
      { title: "Testing & QA", status: "not-started", category: "active", target: "September", notes: "Civ QA + TAP UAT" },
      { title: "Deployment & Go-Live", status: "not-started", category: "active", target: "Mid-October", notes: "Cloud or on-prem TBD" },
      { title: "Training & Handoff", status: "not-started", category: "active", target: "Late October", notes: "All three orgs" },
    ],
  },
  {
    name: "Dave Asprey",
    slug: "dave-asprey",
    contractTerm: "Through Apr 30, 2026",
    contractStatus: "signed",
    team: "Allison (lead)",
    items: [
      { title: "Social Content — Wind Down", status: "in-production", category: "active", owner: "Allison", notes: "Daily posts + ManyChat flows weekdays, pre-scheduled weekends. Account ends EOM April." },
      { title: "Disconnect Google Sheet from ManyChat", status: "not-started", category: "active", owner: "Jason", target: "Wed 4/29", notes: "Clean cutoff task" },
    ],
  },
  {
    name: "AG1",
    slug: "ag1",
    contractStatus: "unsigned",
    team: "Jill (lead), Allison (strategy), Lane (CD), Kathy (copy), Sami (community mgmt)",
    items: [
      { title: "Social Content Trial", status: "not-started", category: "active", notes: "30-day trial. 5-7 posts/week, possibly clipping work. Verbal, SOW being drafted." },
    ],
  },
  {
    name: "EDF",
    slug: "edf",
    contractStatus: "unsigned",
    team: "Jill (lead)",
    items: [
      { title: "TBD — Work may pick up w/o 4/13", status: "not-started", category: "active", notes: "Recent meeting to learn more. Need updates from Jill and Kathy." },
    ],
  },
  {
    name: "Wilsonart",
    slug: "wilsonart",
    contractStatus: "signed",
    team: "Allison (lead), Lane (CD)",
    items: [
      { title: "Chester Videos", status: "in-production", category: "active", owner: "Lane", notes: "Wrapping up this week. TBD on campaign extension." },
    ],
  },
  {
    name: "ABM",
    slug: "abm",
    contractStatus: "unsigned",
    team: "Jill (lead)",
    items: [
      { title: "RFP Response", status: "in-production", category: "active", owner: "Jill", notes: "Competing against 8 agencies. 30-min meeting held last week. Need scope + timeline from Jill." },
    ],
  },
];

// ── This Week (w/o 4/6/2026) ─────────────────────────────
// CORRECTED: Source data said "Monday 4/7" but Monday is 4/6.
// All dates shifted back by one to match actual calendar.

export const thisWeek: WeekDayData[] = [
  {
    date: "2026-04-06", // Monday
    items: [
      { title: "CDS Messaging & Pillars R1 (Gate for all CDS content)", account: "Convergix", owner: "Kathy", resources: "Kathy, Lane", type: "delivery", notes: "Next Step: R1 goes to Daniel Tue 4/7." },
      { title: "CDS Creative Wrapper R1", account: "Convergix", owner: "Kathy", resources: "Roz", type: "delivery", notes: "Next Step: Design Creative Wrapper - Due 4/7" },
      { title: "New Capacity — JJ Revisions", account: "Convergix", owner: "Kathy", resources: "Roz", type: "review", notes: "Next Step: Creative to lay in JJ feedback, 2 slides left" },
      { title: "Events Page Copy", account: "Convergix", owner: "Kathy", resources: "Kathy", type: "delivery", notes: "Next Step: Write Copy. AIST first week of May most urgent" },
      { title: "Social Post Approval", account: "Convergix", owner: "Kathy", resources: "Ronan", type: "approval", notes: "Next Step: Slack Daniel for 4/7-4/9 approvals" },
      { title: "Rockwell + TI Articles", account: "Convergix", owner: "Kathy", resources: "Kathy", type: "review", notes: "Next Step: Follow up with Daniel" },
      { title: "AARP API meeting", account: "Soundly", owner: "Jill", resources: "Josefina", type: "kickoff", notes: "Next Step: Blocked - On Hold until SOW signed" },
      { title: "AARP Creative KO", account: "Soundly", owner: "Jill", resources: "Lane", type: "kickoff", notes: "Next Step: Blocked - On Hold until SOW signed" },
      { title: "TAP Travel Invoice", account: "TAP", owner: "Jason", resources: "Allie", type: "deadline", notes: "Next Step: Allie to send Travel Actuals to Client" },
    ],
  },
  {
    date: "2026-04-07", // Tuesday
    items: [
      { title: "CDS Messaging", account: "Convergix", owner: "Kathy", resources: "Kathy", type: "deadline", notes: "Next Step: Send R1 to Daniel to review, feedback by 4/11" },
      { title: "New Capacity Content", account: "Convergix", owner: "Kathy", resources: "Roz", type: "delivery", notes: "Next Step: Deliver to JJ" },
      { title: "LPPC copy expected (Permitting + FEMA)", account: "LPPC", owner: "Ronan", resources: "Lane, Leslie", type: "deadline", notes: "Next Step: Design + dev starts after copy arrives" },
      { title: "Route TAP Requirements Doc", account: "TAP", owner: "Jason", resources: "Tim", type: "delivery", notes: "Next Step: Tim merging two versions into final, deliver to Kim" },
    ],
  },
  {
    date: "2026-04-08", // Wednesday
    items: [
      { title: "Route Social designs", account: "Convergix", owner: "Kathy", resources: "Roz", type: "delivery", notes: "Next Step: Show client on Thursday status review" },
      { title: "New Capacity", account: "Convergix", owner: "Kathy", resources: "Lane", type: "review", notes: "Next Step: Finalize then → Brand Guide v2 unblocked" },
      { title: "Copy Updates for Events Page", account: "Convergix", owner: "Kathy", resources: "Kathy, Leslie", type: "deadline", notes: "Next Step: Kathy writing Mon-Wed, handoff to Leslie to lay into Dev" },
      { title: "Bonterra — Paige presenting designs", account: "Bonterra", owner: "Jill", resources: "Paige", type: "delivery", notes: "Next Step: Impact Report design presentation" },
      { title: "HDL Site Copy Review", account: "High Desert Law", owner: "Jill", resources: "Chris", type: "review", notes: "Next Step: HDL to review site copy (Risk: Very behind schedule, blocking delivery)" },
    ],
  },
  {
    date: "2026-04-09", // Thursday
    items: [
      { title: "Raise stale items: Corp Brochure, Life Sci, Templates, Playbook", account: "Convergix", owner: "Kathy", resources: "Ronan", type: "review", notes: "Next Step: After status call with client, what is the update on these?" },
      { title: "Social posts reviewed at status", account: "Convergix", owner: "Ronan", resources: "Roz", type: "review", notes: "Next Step: Awaiting client approval" },
    ],
  },
  {
    date: "2026-04-10", // Friday
    items: [
      { title: "Daniel feedback deadline on CDS Messaging", account: "Convergix", owner: "Kathy", resources: "Kathy", type: "deadline", notes: "Next Step: Awaiting copy approval (Risk: Daniel may miss Friday — follow up Monday 4/6 if needed)" },
      { title: "Bonterra approval needed", account: "Bonterra", owner: "Jill", resources: "Lane", type: "deadline", notes: "Next Step: Client feedback on Impact Report designs. Dev window starts after approval." },
    ],
  },
];

// ── Upcoming ──────────────────────────────────────────────

export const upcoming: WeekDayData[] = [
  {
    date: "2026-04-14", // Monday w/o 4/14
    items: [
      { title: "LPPC Map R2", account: "LPPC", owner: "Ronan", resources: "Roz, Leslie", type: "delivery", notes: "Next Step: Implement feedback based on minor R1 feedback" },
      { title: "CDS Messaging R2 (if feedback received)", account: "Convergix", owner: "Kathy", resources: "Kathy", type: "delivery", notes: "Next Step: Write Copy (Risk: Waiting on Feedback)" },
    ],
  },
  {
    date: "2026-04-15", // Tuesday
    items: [
      { title: "HDL Full Site Design — Civ delivers", account: "High Desert Law", owner: "Jill", resources: "Lane", type: "delivery", notes: "Next Step: Civilization delivers full site design (Risk: Blocked by copy edits)" },
      { title: "HDL Photo Shoot Prep", account: "High Desert Law", owner: "Jill", resources: "Unknown", type: "delivery", notes: "Next Step: Production book + shot list (Risk: Shoot in May, outside SOW Timeline)" },
    ],
  },
  {
    date: "2026-04-20", // Monday w/o 4/20
    items: [
      { title: "Fanuc Award Article enters schedule", account: "Convergix", owner: "Kathy", resources: "Lane, Kathy", type: "kickoff", notes: "Next Step: Write article (Risk: event is 4/28)" },
      { title: "CDS Social Posts KO", account: "Convergix", owner: "Kathy", resources: "Kathy, Lane", type: "kickoff", notes: "Next Step: Waiting on messaging to be approved." },
    ],
  },
  {
    date: "2026-04-21", // Tuesday
    items: [
      { title: "Soundly iFrame launch (evening)", account: "Soundly", owner: "Jill", resources: "Leslie", type: "launch", notes: "Next Step: Waiting on client for feedback. Goes Live 4/22 (Risk: On UHG timeline)" },
    ],
  },
  {
    date: "2026-04-22", // Wednesday
    items: [
      { title: "HDL Full Site Design Approval", account: "High Desert Law", owner: "Jill", resources: "Chris, Lane, Leslie", type: "deadline", notes: "Next Step: Lock on copy and move to development" },
    ],
  },
  {
    date: "2026-04-23", // Thursday
    items: [
      { title: "Bonterra Impact Report — code handoff", account: "Bonterra", owner: "Jill", resources: "Leslie", type: "deadline", notes: "Next Step: Impact Report K/O to Dev (Risk: Hard client deadline. Client was 3 weeks late on content)" },
    ],
  },
  {
    date: "2026-04-25", // Friday
    items: [
      { title: "CDS Landing Page KO", account: "Convergix", owner: "Kathy", resources: "Lane", type: "kickoff", notes: "Next Step: Kick of Landing Page (Risk: If messaging is approved)" },
    ],
  },
  {
    date: "2026-04-29", // Tuesday
    items: [
      { title: "Disconnect Google Sheet from Dave ManyChat", account: "Dave Asprey", owner: "Jason", resources: "Jason", type: "deadline", notes: "Next Step: Disconnect Drive integration from Dave's ManyChat" },
    ],
  },
  {
    date: "2026-04-30", // Wed — end of April
    items: [
      { title: "Hopdoddy Brand Refresh Website launch", account: "Hopdoddy", owner: "Ronan", resources: "Leslie", type: "launch", notes: "Next Step: Launch Hopdoddy Brand Refresh updates (Risk: Hard deadline for National Burger Day)" },
    ],
  },
  {
    date: "2026-05-01", // Thursday
    items: [
      { title: "HDL Start Development", account: "High Desert Law", owner: "Jill", resources: "Leslie", type: "kickoff", notes: "Next Step: Development K/O (Risk: Blocked by design approval)" },
    ],
  },
  {
    date: "2026-05-04", // Monday w/o 5/4
    items: [
      { title: "LPPC Map + Website Launch", account: "LPPC", owner: "Ronan", resources: "Leslie", type: "launch", notes: "Next Step: Launch LPPC Map + Website" },
      { title: "AIST tradeshow", account: "Convergix", owner: "Kathy", resources: "Leslie", type: "deadline", notes: "Next Step: Launch Events page (Risk: must be live by ???)" },
    ],
  },
  {
    date: "2026-05-05", // Tuesday
    items: [
      { title: "CDS Case Study + Brochure KO", account: "Convergix", owner: "Kathy", resources: "Lane", type: "kickoff", notes: "Next Step: Kickoff Creative (Risk: If messaging approved)" },
    ],
  },
  {
    date: "2026-05-11", // Sunday
    items: [
      { title: "Bonterra Impact Report — Go Live", account: "Bonterra", owner: "Jill", resources: "Leslie", type: "deadline", notes: "Next Step: Launch Impact Report (Risk: tight given compressed timeline)" },
    ],
  },
];

// ── Pipeline (unsigned SOWs + new business) ───────────────

export const pipeline: PipelineData[] = [
  {
    account: "Bonterra",
    title: "Impact Report SOW",
    value: "$55,000",
    status: "at-risk",
    notes: "Work active despite unsigned SOW",
  },
  {
    account: "Soundly",
    title: "AARP Member Login + Landing Page",
    value: "$31,400",
    status: "at-risk",
    waitingOn: "Soundly to sign",
    notes: "Not starting until signed. Launch 7/15. HIGH PRIORITY.",
  },
  {
    account: "Beyond Petrochemicals",
    title: "ITEP Landing Page + Social",
    value: "$20,000",
    status: "sow-sent",
    waitingOn: "Client to sign",
    notes: "Term Apr 1 – Apr 30. Long-scroll page, static charts, 3 social, fact sheet.",
  },
  {
    account: "Beyond Petrochemicals",
    title: "SpillTracker Redesign",
    value: "$28,000",
    status: "sow-sent",
    waitingOn: "Client to sign",
    notes: "SOW sent w/o 3/9. Full redesign: interactive map, database, partner page, Spanish.",
  },
  {
    account: "Beyond Petrochemicals",
    title: "Clipping Campaign (Plastic Detox)",
    value: "$15,000",
    status: "sow-sent",
    waitingOn: "Client to sign",
    notes: "Uses $20K underspend from RLF. Up to 3 campaigns.",
  },
  {
    account: "Beyond Petrochemicals",
    title: "Ammonia Landing Page",
    value: "TBD",
    status: "drafting",
    waitingOn: "Jill drafting scope",
    notes: "Client wants ASAP. Scope TBD.",
  },
  {
    account: "AG1",
    title: "Social Content Trial",
    value: "$30,000",
    status: "drafting",
    waitingOn: "SOW to be drafted",
    notes: "30-day trial. Potential $30K/mo annual retainer if successful.",
  },
];
