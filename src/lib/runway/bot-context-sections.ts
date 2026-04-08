/**
 * Runway Bot Context — data & reference section builders
 *
 * Builds prompt sections that depend on reference data: dates, identity,
 * team roster, client map, and query recipes.
 */

import { TEAM_REFERENCES } from "./reference/team";
import { CLIENT_REFERENCES } from "./reference/clients";
import { getMonday, toISODateString } from "@/app/runway/date-utils";
import { DAY_NAMES, MONTH_NAMES } from "./date-constants";
import type { TeamMemberRecord } from "./operations-context";

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

export function buildTeamRoster(): string {
  const lines = TEAM_REFERENCES.map((m) => {
    const accounts = m.accountsLed.length > 0
      ? ` (leads: ${m.accountsLed.join(", ")})`
      : "";
    return `- ${m.firstName} (${m.fullName}): ${m.title}, ${m.roleCategory}${accounts}`;
  });

  return `## Team roster
${lines.join("\n")}

### Name disambiguation
- "Lane" = Lane Jordan (Creative Director). Ronan Lane is the PM. If ambiguous, ask.
- "Allie" = Allison Shannon (Account Manager).
- If someone says "the dev team" or "creative", filter by role category.`;
}

export function buildClientMap(): string {
  const lines = CLIENT_REFERENCES.map((c) => {
    const nicknames = c.nicknames.join(" or ");
    const contactList = c.contacts.length > 0
      ? ` Contacts: ${c.contacts.map((ct) => ct.role ? `${ct.name} (${ct.role})` : ct.name).join(", ")}.`
      : "";
    return `- ${nicknames} = ${c.fullName} (slug: ${c.slug}).${contactList}`;
  });

  return `## Client map
${lines.join("\n")}

### Client contacts vs team members
- Client contacts are NOT Civilization team members.
- If someone says "Daniel is sitting on it", that means a CLIENT contact has the ball.
- Use get_client_contacts to look up who's holding things up at a client.`;
}

export function buildQueryRecipes(): string {
  return `## When answering questions
Use the date context above. Never ask the user for dates or ISO formats.

- "what am I working on today" / "what's on my plate today" / "what do I have today":
  Call get_person_workload with the person's name. This searches BOTH owner and resource fields. From the results, show only week items matching today's date. "My plate" means everything I own or am working on.
- "what am I responsible for" / "what do I own":
  Call get_week_items with weekOf = this week's Monday, owner = the person's name. They want only tasks they're accountable for.
- "what am I the resource on" / "what am I actually doing":
  Call get_week_items with weekOf = this week's Monday, resource = the person's name. They want only tasks where they're doing the hands-on work.
- "what's the week look like" / "rundown" / "what's on tap this week":
  Call get_week_items with weekOf = this week's Monday. Show all items grouped by day.
- "what about next week" / "what's coming up":
  Compute next Monday (add 7 days to this week's Monday). Call get_week_items with that date.
- "what's on [person]'s plate" / "what does [person] have":
  Call get_person_workload with personName. This searches both owner and resource fields.
- "what's the deal with [client]" / "how's [client] going":
  Call get_projects with the client slug.
- "what's in the pipeline":
  Call get_pipeline.
- "who's holding things up at [client]":
  Call get_client_contacts with the client slug, then cross-reference with get_projects filtered by waitingOn.`;
}
