/** Runway Slack Bot Tools — thin wrappers around shared Runway operations. */

import { tool } from "ai";
import { z } from "zod";
import { postUpdate } from "./updates-channel";
import {
  getClientsWithCounts,
  getProjectsForClient,
  getPipelineData,
  getWeekItemsData,
  getClientBySlug,
  updateProjectStatus,
  addUpdate,
} from "@/lib/runway/operations";

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
      description: "List projects for a client",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug (e.g. 'convergix')"),
      }),
      execute: async ({ clientSlug }) => {
        const client = await getClientBySlug(clientSlug);
        if (!client) return { error: `Client '${clientSlug}' not found` };

        const projectList = await getProjectsForClient(client.id);
        return projectList.map((p) => ({
          name: p.name,
          status: p.status,
          owner: p.owner,
          waitingOn: p.waitingOn,
          notes: p.notes,
        }));
      },
    }),

    get_pipeline: tool({
      description: "List all pipeline/unsigned SOWs",
      inputSchema: z.object({}),
      execute: async () => getPipelineData(),
    }),

    get_week_items: tool({
      description: "Get this week's calendar items",
      inputSchema: z.object({
        weekOf: z
          .string()
          .optional()
          .describe("ISO date of the Monday (e.g. '2026-04-06')"),
      }),
      execute: async ({ weekOf }) => getWeekItemsData(weekOf),
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
  };
}
