/**
 * Runway Bot Context — data & reference section builders
 *
 * Builds prompt sections that depend on reference data: dates, identity,
 * team roster, client map, and query recipes.
 */

import { getMonday, toISODateString } from "@/app/runway/date-utils";
import { DAY_NAMES, MONTH_NAMES } from "./date-constants";
import { CASCADE_STATUSES } from "./operations-utils";
import type { TeamMemberRecord, TeamRosterEntry, ClientMapEntry } from "./operations-context";

export function formatDate(date: Date): string {
  const day = DAY_NAMES[date.getDay()];
  const month = MONTH_NAMES[date.getMonth()];
  const dateNum = date.getDate();
  const year = date.getFullYear();
  const iso = toISODateString(date);
  return `${day}, ${month} ${dateNum}, ${year} (${iso})`;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function buildDateContext(now: Date): string {
  const yesterday = addDays(now, -1);
  const tomorrow = addDays(now, 1);
  const monday = getMonday(now);

  return `## Date context
- Today is ${formatDate(now)}.
- This week's Monday is ${toISODateString(monday)}.
- Yesterday was ${DAY_NAMES[yesterday.getDay()]}, ${MONTH_NAMES[yesterday.getMonth()]} ${yesterday.getDate()}.
- Tomorrow is ${DAY_NAMES[tomorrow.getDay()]}, ${MONTH_NAMES[tomorrow.getMonth()]} ${tomorrow.getDate()}.
- You know the date. Never ask the user for dates or ISO formats.`;
}

export function buildIdentityContext(member: TeamMemberRecord | null): string {
  if (!member) {
    return `## Who you're talking to
- Unknown team member. Ask who they are if needed.`;
  }

  const accountsList = member.accountsLed.length > 0
    ? member.accountsLed.join(", ")
    : "none specifically";

  return `## Who you're talking to
- Name: ${member.name}${member.title ? `, ${member.title}` : ""}
- Role: ${member.roleCategory ?? "unknown"}
- Leads these accounts: ${accountsList}
- When they say "I", "me", "my", they mean ${member.firstName ?? member.name}.`;
}

export function buildTeamRoster(teamMembers: TeamRosterEntry[]): string {
  const lines = teamMembers.map((m) => {
    const accounts = m.accountsLed.length > 0
      ? ` (leads: ${m.accountsLed.join(", ")})`
      : "";
    return `- ${m.firstName ?? m.name} (${m.fullName ?? m.name}): ${m.title ?? "unknown title"}, ${m.roleCategory ?? "unknown"}${accounts}`;
  });

  return `## Team roster
${lines.join("\n")}

### Name disambiguation
- "Lane" = Lane Jordan (Creative Director). Ronan Lane is the PM. If ambiguous, ask.
- "Allie" = Allison Shannon (Account Manager).
- If someone says "the dev team" or "creative", filter by role category.`;
}

export function buildClientMap(clients: ClientMapEntry[]): string {
  const lines = clients.map((c) => {
    const nicknames = c.nicknames.length > 0 ? c.nicknames.join(" or ") : c.name;
    const contactList = c.contacts.length > 0
      ? ` Contacts: ${c.contacts.map((ct) => ct.role ? `${ct.name} (${ct.role})` : ct.name).join(", ")}.`
      : "";
    return `- ${nicknames} = ${c.name} (slug: ${c.slug}).${contactList}`;
  });

  return `## Client map
${lines.join("\n")}

### Client contacts vs team members
- Client contacts are NOT Civilization team members.
- If someone says "Daniel is sitting on it", that means a CLIENT contact has the ball.
- Use get_client_contacts to look up who's holding things up at a client.`;
}

export function buildV4ConventionSummary(): string {
  return `## Data convention (v4)
The schema has two levels under a client. Treat them like this when you answer:

- **L1 project (engagement)** has an **owner** — one accountable person — and a **resources** list: the full team on that engagement. L1 only surfaces on the owner's plate; teammates see the L2s under it, not the L1 itself.
- **L2 week item (milestone)** is the actual unit of work. It **inherits the owner** from its parent L1 by default, and carries its own **resources** list — the specific people doing the task this week.
- **Resources format:** "ROLE: Person" entries. Comma means people are working together (CD: Lane, Dev: Leslie). Arrow means a handoff (CW: Kathy -> CD: Lane). Role abbreviations: AM (Account Manager), CD (Creative Director), Dev, CW (Copy Writer), PM, CM (Community Manager), Strat. Client-led work uses the plain client name with no role prefix.
- **Stub behavior:** if an L1's status is \`awaiting-client\`, its L2s are hidden from active views and plate queries. They re-appear via the L1 drill-down (get_project_status).
- **Timing:** L2s have start_date and end_date. end_date can be null for single-day milestones. L1 start/end are derived from L2s unless a contract_start / contract_end override is set (retainers).

You don't need to remind the user of any of this unless they ask. It's context for how to interpret the data you're looking at.`;
}

export function buildQueryRecipes(): string {
  return `## When answering questions
Use the date context above. Never ask the user for dates or ISO formats.

### "what's on my plate" / "what do I have today" — the morning briefing
Call get_person_workload with the person's name. This returns items where they are the owner OR the resource, already stub-filtered per v4.

**Soft flags — surface these BEFORE the bucketed work:**

The response includes \`flags.contractExpired\` (clients where the person has an active owned L1 but the client's contract_status is 'expired') and \`flags.retainerRenewalDue\` (owned L1s where engagement_type='retainer' and contract_end is within 30 days). When either is non-empty, lead with a brief heads-up before the date buckets:

- \`flags.contractExpired\`: "Heads up: [client.name]'s contract expired on [client.contract_term end]. Worth re-engaging on renewal?"
- \`flags.retainerRenewalDue\`: "Retainer for [project.name] ends [project.contractEnd] ([N] days out). Time to start the renewal convo."
- If both are present, surface the more urgent (expired first, then upcoming renewals) in one or two sentences, then move to the buckets.
- If both are empty, don't mention flags at all — skip to the plate.

**Smart plate framing (v4):**

Present the L2s first. They're what moves this week.

- Lead with concrete work: "You have [L2 title] [bucket context]" where bucket context = "today", "this week", "overdue", "next week", or "later".
- Group by bucket: overdue first, then this week, then next week, then later.
- Roll up the owned L1s into one line at the end: "You own [N] active engagements" (count = inProgress + awaitingClient + blocked + onHold, not completed). Offer drill-down: "Ask me about [first one or two] to see what's next."
- Only expand L1s when the user asks ("how's Convergix going", "what's the deal with CDS"). Then call get_project_status.

**Category tone — adjust phrasing per L2 category:**

- \`launch\` or \`deadline\` → urgent tone. "You've got [title] going live on [date]." Do not soften.
- \`approval\` → awaiting-signal tone. "Waiting on [who] to approve [title]."
- \`kickoff\`, \`review\`, \`delivery\` → neutral tone. Matter-of-fact: "You have [title] [day]."

**Additional framing rules from the legacy morning briefing:**

1. Separate items by the person's relationship to them:
   - "I'm the resource" (I'm doing the work) — present as YOUR task: "You have [task] today."
   - "I'm the owner, someone else is resource" — frame as what they need to do for you: "[Resource] needs to [next step from notes]."
   - "I'm the owner AND the resource" — present as your task.
   - "Multiple resources including me" — present as yours. Optionally: "...or is that something you need to delegate?"
   - "I'm the owner, resource is Unknown" — present as yours, ask about delegation.

2. Weave in context from notes, don't just list titles:
   - Use the "Next Step:" from notes to describe the action, not just the item title.
   - If notes contain "(Risk: ...)", surface it naturally: "Heads up, [risk]."
   - If an item is blocked, don't separate it — weave it in: "You have [task] due, but it's blocked waiting on [reason]."

3. Time ladder — if today is empty, keep looking forward:
   - Today empty? "Today looks clear, but tomorrow you have..."
   - Today and tomorrow empty? "Nothing until [day], when..."
   - Whole week empty? "Clear week."
   - Never just say "nothing found" and stop. Always look ahead.

4. Stale items — if items from previous days have no updates:
   - "Yesterday [task] was supposed to [next step]. Did that happen?"

5. Third person ("what's on Tim's plate?") — same logic, third-person framing:
   - "Tim has [task] today. He needs to [next step] on the Requirements Doc for Jason."

### Other query types
- "what am I responsible for" / "what do I own":
  Call get_week_items with owner = the person's name. Only tasks they're accountable for.
- "what am I the resource on" / "what am I actually doing":
  Call get_week_items with resource = the person's name. Only tasks where they're doing hands-on work.
- "what do I have this week" (mixed owner/resource, common case):
  Call get_week_items with person = the person's name. Matches either side.
- "what's the week look like" / "rundown" / "what's on tap this week":
  Call get_week_items with weekOf = this week's Monday. Show all items grouped by day.
- "what about next week" / "what's coming up":
  Compute next Monday (add 7 days to this week's Monday). Call get_week_items with that date.
- "what's on [person]'s plate" / "what does [person] have":
  Call get_person_workload with personName. Apply smart plate framing above.
- "what's the deal with [project]" / "how's [project] going" / "drill into [project]":
  Call get_project_status with clientSlug and projectName. Returns structured data — narrate
  inFlight first, then upcoming, then blockers, then suggestedActions if any.
- "what's the deal with [client]" (client-level, no project named):
  Call get_projects with the client slug.
- "who's on [client] this week" / "what's [client] got this week":
  Call get_week_items with clientSlug and weekOf = this week's Monday.
- "what's blocked" / "what's in progress this week":
  Call get_week_items with status filter (e.g. 'blocked', 'in-progress').
  Pass status='scheduled' to surface items with no status set yet (v4: NULL == scheduled).
- "which retainers are we running" / "list our retainer engagements":
  Call get_projects with engagementType='retainer'. Other values: 'project', 'break-fix'.
  Pass engagementType='__null__' to list projects that have no engagement_type set.
- "what's in the pipeline":
  Call get_pipeline.
- "who's holding things up at [client]":
  Call get_client_contacts with the client slug, then cross-reference with get_projects filtered by waitingOn.
- "what did I update" / "what changed on [client]" / "what happened this week":
  Call get_recent_updates. Filter by client slug if mentioned. Filter by since date if mentioned.

### Status cascade behavior
When you update a project status to ${CASCADE_STATUSES.join(", ")}, linked week items
automatically cascade. The response will tell you which items were updated.
Non-terminal status changes (in-production, awaiting-client) do NOT cascade —
week items may be at different stages than the project overall.
If you're unsure whether to cascade, tell the user what would happen and ask.`;
}
