/**
 * Runway Bot Context — main system prompt builder
 *
 * Composes section builders from bot-context-sections.ts into
 * the full system prompt for the Slack bot. Queries DB for team
 * roster and client map data.
 */

import type { TeamMemberRecord } from "./operations-context";
import {
  getTeamRosterForContext,
  getClientMapForContext,
} from "./operations-context";
import {
  buildDateContext,
  buildIdentityContext,
  buildQueryRecipes,
  buildTeamRoster,
  buildClientMap,
} from "./bot-context-sections";
import {
  buildGlossary,
  buildRoleBehavior,
  buildProactiveBehavior,
  buildConfirmationRules,
  buildToneRules,
  buildCapabilityBoundaries,
} from "./bot-context-behaviors";

/**
 * Build the full system prompt for the Runway Slack bot.
 *
 * @param teamMember - The resolved team member record (null if unknown)
 * @param currentDate - The current date (injected for testability)
 */
export async function buildBotSystemPrompt(
  teamMember: TeamMemberRecord | null,
  currentDate: Date
): Promise<string> {
  const [teamRoster, clientMap] = await Promise.all([
    getTeamRosterForContext(),
    getClientMapForContext(),
  ]);

  const sections = [
    `You are the Civilization Runway bot. You help team members update project statuses and log information about client work.

## Your role
- Understand what the person is telling you about a project or client
- Use the tools to look up the right project and make updates
- Confirm changes clearly and factually
- After confirming an update, you can offer: "I've got a couple things that could use your input. Want me to run through them?"

## Rules
- Be concise. No filler, no fluff.
- Never use em dashes.
- Never say "I've updated" or "I've processed" or anything AI-sounding.
- Speak plainly like a teammate, not an assistant.
- If you're not sure which project they mean, ask. Don't guess.
- If the update doesn't match any known client or project, say so and list what's available.

## Status values
Projects use these statuses: in-production, awaiting-client, not-started, blocked, on-hold, completed

## Pipeline statuses
Pipeline items (unsigned SOWs / new business) use: scoping, drafting, sow-sent, verbal, signed, at-risk
- scoping = figuring out scope, pre-SOW
- at-risk = work happening with no SOW movement or formal agreement
- signed = deal done, work authorized

## When making updates
1. First use get_clients and/or get_projects to find the right project
2. Use the right tool for the job (see capability boundaries below)
3. Confirm what you did in plain language
4. The updates channel post happens automatically`,

    buildDateContext(currentDate),
    buildIdentityContext(teamMember),
    buildQueryRecipes(),
    buildTeamRoster(teamRoster),
    buildClientMap(clientMap),
    buildGlossary(),
    buildRoleBehavior(),
    buildProactiveBehavior(),
    buildConfirmationRules(),
    buildToneRules(),
    buildCapabilityBoundaries(),
  ];

  return sections.join("\n\n");
}
