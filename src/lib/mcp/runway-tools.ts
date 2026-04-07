/** Runway MCP Tool Registrations — thin formatting layer over shared operations. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getClientsWithCounts,
  getProjectsFiltered,
  getWeekItemsData,
  getPersonWorkload,
  getPipelineData,
  getUpdatesData,
  getTeamMembersData,
  getClientContacts,
  updateProjectStatus,
  addProject,
  addUpdate,
} from "@/lib/runway/operations";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function textMessage(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}

function operationResultMessage(result: { ok: boolean; message?: string; error?: string }) {
  return textMessage(result.ok ? result.message! : result.error!);
}

export function registerRunwayTools(server: McpServer) {
  server.tool("get_clients", "List all clients with project counts", {},
    async () => textResult(await getClientsWithCounts()));

  server.tool("get_projects", "List projects, optionally filtered by client, status, owner, or waitingOn", {
    clientSlug: z.string().optional().describe("Filter by client slug (e.g. 'convergix')"),
    status: z.string().optional().describe("Filter by status (e.g. 'in-production', 'blocked')"),
    owner: z.string().optional().describe("Filter by owner name (case-insensitive substring, e.g. 'Kathy')"),
    waitingOn: z.string().optional().describe("Filter by waitingOn name (case-insensitive substring, e.g. 'Daniel')"),
  }, async ({ clientSlug, status, owner, waitingOn }) => textResult(await getProjectsFiltered({ clientSlug, status, owner, waitingOn })));

  server.tool("get_week_items", "Get calendar items for a specific week, optionally filtered by owner", {
    weekOf: z.string().optional().describe("ISO date of the Monday (e.g. '2026-04-06')"),
    owner: z.string().optional().describe("Filter by owner name (case-insensitive substring, e.g. 'Kathy')"),
  }, async ({ weekOf, owner }) => textResult(await getWeekItemsData(weekOf, owner)));

  server.tool("get_pipeline", "List all pipeline/unsigned SOWs", {},
    async () => textResult(await getPipelineData()));

  server.tool("get_updates", "Get recent update history, optionally filtered by client slug", {
    clientSlug: z.string().optional().describe("Filter by client slug"),
    limit: z.number().optional().default(20).describe("Max updates to return"),
  }, async ({ clientSlug, limit }) => textResult(await getUpdatesData({ clientSlug, limit })));

  server.tool("update_project_status", "Change a project's status and log the update", {
    clientSlug: z.string().describe("Client slug (e.g. 'convergix')"),
    projectName: z.string().describe("Project name (fuzzy match)"),
    newStatus: z.string().describe("New status value"),
    updatedBy: z.string().describe("Person making the update"),
    notes: z.string().optional().describe("Additional context"),
  }, async (params) => operationResultMessage(await updateProjectStatus(params)));

  server.tool("add_project", "Create a new project under a client", {
    clientSlug: z.string().describe("Client slug"),
    name: z.string().describe("Project name"),
    status: z.string().optional().default("not-started"),
    category: z.string().optional().default("active"),
    owner: z.string().optional(),
    notes: z.string().optional(),
    updatedBy: z.string().describe("Person adding the project"),
  }, async (params) => operationResultMessage(await addProject(params)));

  server.tool("add_update", "Log a free-form update for a client or project", {
    clientSlug: z.string().describe("Client slug"),
    projectName: z.string().optional().describe("Project name (fuzzy match)"),
    summary: z.string().describe("The update text"),
    updatedBy: z.string().describe("Person making the update"),
  }, async (params) => operationResultMessage(await addUpdate(params)));

  server.tool("get_team_members", "List team members, roles, and what they track", {},
    async () => textResult(await getTeamMembersData()));

  server.tool("get_person_workload", "Get all week items and projects assigned to a person, grouped by client", {
    personName: z.string().describe("Person's name (e.g. 'Kathy', 'Roz')"),
  }, async ({ personName }) => textResult(await getPersonWorkload(personName)));

  server.tool("get_client_contacts", "Get client-side contacts for a given client",
    { clientSlug: z.string().describe("Client slug") },
    async ({ clientSlug }) => {
      const result = await getClientContacts(clientSlug);
      if (!result) return textMessage(`Client '${clientSlug}' not found.`);
      return textResult(result);
    });
}
