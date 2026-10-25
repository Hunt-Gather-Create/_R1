/**
 * Reads staffing from Runway: every client's team and nicknames, and every
 * team member. Read only.
 */
import { clients, teamMembers } from "../../src/lib/db/runway-schema";
import type { createRunwayDb } from "../lib/run-script";
import { staffingFromRows, type Staffing } from "./staffing";

type RunwayDb = ReturnType<typeof createRunwayDb>["db"];

export async function loadStaffing(db: RunwayDb): Promise<Staffing> {
  const clientRows = await db
    .select({ slug: clients.slug, name: clients.name, nicknames: clients.nicknames, team: clients.team })
    .from(clients);
  const memberRows = await db
    .select({
      name: teamMembers.name,
      firstName: teamMembers.firstName,
      fullName: teamMembers.fullName,
      roleCategory: teamMembers.roleCategory,
      accountsLed: teamMembers.accountsLed,
      isActive: teamMembers.isActive,
    })
    .from(teamMembers);
  return staffingFromRows(clientRows, memberRows);
}
