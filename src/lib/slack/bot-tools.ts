/** Runway Slack Bot Tools — thin wrappers around shared Runway operations. */

import { tool } from "ai";
import { z } from "zod";
import { postUpdate } from "./updates-channel";
import {
  getClientsWithCounts,
  getProjectsFiltered,
  getPipelineData,
  getWeekItemsData,
  getPersonWorkload,
  updateProjectStatus,
  addUpdate,
} from "@/lib/runway/operations";
import { getClientContactsRef } from "@/lib/runway/reference/clients";

async function safePostUpdate(update: Parameters<typeof postUpdate>[0]) {
  try {
    await postUpdate(update);
  } catch (err) {
    console.error("[Runway Bot] Failed to post to updates channel:", err);
  }
}

export function createBotTools(userName: string) {
  return {
    get_clients: tool({
      description: "List all clients with project counts",
      inputSchema: z.object({}),
      execute: async () => getClientsWithCounts(),
    }),

    get_projects: tool({
      description: "List projects, optionally filtered by client, owner, or waitingOn",
      inputSchema: z.object({
        clientSlug: z.string().optional().describe("Client slug (e.g. 'convergix')"),
        owner: z.string().optional().describe("Filter by owner name (case-insensitive substring, e.g. 'Kathy')"),
        waitingOn: z.string().optional().describe("Filter by waitingOn name (case-insensitive substring, e.g. 'Daniel')"),
      }),
      execute: async ({ clientSlug, owner, waitingOn }) => {
        return getProjectsFiltered({ clientSlug, owner, waitingOn });
      },
    }),

    get_pipeline: tool({
      description: "List all pipeline/unsigned SOWs",
      inputSchema: z.object({}),
      execute: async () => getPipelineData(),
    }),

    get_week_items: tool({
      description: "Get this week's calendar items, optionally filtered by owner",
      inputSchema: z.object({
        weekOf: z
          .string()
          .optional()
          .describe("ISO date of the Monday (e.g. '2026-04-06')"),
        owner: z
          .string()
          .optional()
          .describe("Filter by owner name (case-insensitive substring, e.g. 'Kathy')"),
      }),
      execute: async ({ weekOf, owner }) => getWeekItemsData(weekOf, owner),
    }),

    update_project_status: tool({
      description: "Change a project's status",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug"),
        projectName: z.string().describe("Project name (fuzzy match)"),
        newStatus: z.string().describe("New status value"),
        notes: z.string().optional().describe("Additional context"),
      }),
      execute: async ({ clientSlug, projectName, newStatus, notes }) => {
        const result = await updateProjectStatus({
          clientSlug,
          projectName,
          newStatus,
          updatedBy: userName,
          notes,
        });

        if (!result.ok) {
          return { error: result.error, available: result.available };
        }

        // Post to updates channel (bot-specific behavior)
        if (result.data) {
          const updateText = `${result.data.previousStatus} -> ${result.data.newStatus}${notes ? ` (${notes})` : ""}`;
          await safePostUpdate({
            clientName: result.data.clientName as string,
            projectName: result.data.projectName as string,
            updateText,
            updatedBy: userName,
          });
        }

        return { result: result.message };
      },
    }),

    add_update: tool({
      description: "Log a free-form update for a client or project",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug"),
        projectName: z
          .string()
          .optional()
          .describe("Project name (fuzzy match)"),
        summary: z.string().describe("The update text"),
      }),
      execute: async ({ clientSlug, projectName, summary }) => {
        const result = await addUpdate({
          clientSlug,
          projectName,
          summary,
          updatedBy: userName,
        });

        if (!result.ok) {
          return { error: result.error };
        }

        // Post to updates channel (bot-specific behavior)
        if (result.data) {
          await safePostUpdate({
            clientName: result.data.clientName as string,
            projectName: result.data.projectName as string | undefined,
            updateText: summary,
            updatedBy: userName,
          });
        }

        return { result: result.message };
      },
    }),

    get_person_workload: tool({
      description:
        "Get all week items and projects assigned to a person, grouped by client. Powers 'what's on X's plate?' questions.",
      inputSchema: z.object({
        personName: z.string().describe("Person's name (e.g. 'Kathy', 'Roz')"),
      }),
      execute: async ({ personName }) => getPersonWorkload(personName),
    }),

    get_client_contacts: tool({
      description:
        "Get client-side contacts for a given client. Powers 'who's holding things up at X?' questions.",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug (e.g. 'convergix')"),
      }),
      execute: async ({ clientSlug }) => {
        const contacts = getClientContactsRef(clientSlug);
        if (contacts.length === 0) {
          return { client: clientSlug, contacts: [], note: "No contacts on file for this client" };
        }
        return { client: clientSlug, contacts };
      },
    }),
  };
}
