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
  addProject,
  addUpdate,
  updateProjectField,
  createWeekItem,
  updateWeekItemField,
  undoLastChange,
  getRecentUpdates,
} from "@/lib/runway/operations";
import { getClientContactsRef } from "@/lib/runway/reference/clients";
import { getMonday, toISODateString } from "@/app/runway/date-utils";

async function safePostUpdate(update: Parameters<typeof postUpdate>[0]) {
  try {
    await postUpdate(update);
  } catch (err) {
    console.error(JSON.stringify({
      event: "runway_bot_post_error",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

export function createBotTools(userName: string, now: Date = new Date()) {
  const currentMonday = toISODateString(getMonday(now));
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
      description: `Get calendar items for a given week, optionally filtered by owner or resource. Owner = who is accountable. Resource = who is doing the work. The weekOf parameter defaults to the current week (${currentMonday}) — do not ask the user for a date.`,
      inputSchema: z.object({
        weekOf: z
          .string()
          .default(currentMonday)
          .describe(`ISO date of the Monday for the week to query. Defaults to ${currentMonday} (this week). Use this for "next week" or "last week" queries — never ask the user for a raw date.`),
        owner: z
          .string()
          .optional()
          .describe("Filter by owner name (person accountable, case-insensitive substring, e.g. 'Kathy')"),
        resource: z
          .string()
          .optional()
          .describe("Filter by resource name (person doing the work, case-insensitive substring, e.g. 'Roz')"),
      }),
      execute: async ({ weekOf, owner, resource }) => {
        return getWeekItemsData(weekOf, owner, resource);
      },
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

        const cascaded = result.data?.cascadedItems as string[] | undefined;

        // Post to updates channel -- skip only true no-ops (no status change AND no notes)
        if (result.data && (result.data.previousStatus !== result.data.newStatus || notes)) {
          const updateText = `${result.data.previousStatus} -> ${result.data.newStatus}${notes ? ` (${notes})` : ""}${cascaded?.length ? ` [+${cascaded.length} week items]` : ""}`;
          await safePostUpdate({
            clientName: result.data.clientName as string,
            projectName: result.data.projectName as string,
            updateText,
            updatedBy: userName,
          });
        }

        const cascadeNote = cascaded?.length
          ? ` Also updated ${cascaded.length} linked week item(s): ${cascaded.join(", ")}.`
          : "";

        if (!result.data) return { result: result.message + cascadeNote };

        const d = result.data;
        const statusDetail = `Updated status for ${d.projectName} (${d.clientName}). Was: ${d.previousStatus}, now: ${d.newStatus}.`;
        return { result: statusDetail + cascadeNote };
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
        "Get all week items and projects where a person is owner OR resource, grouped by client. Powers 'what's on X's plate?' questions.",
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

    create_project: tool({
      description:
        "Create a new project under a client. Use when someone says they want to add a project.",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug"),
        name: z.string().describe("Project name"),
        status: z.string().optional().describe("Initial status (default: not-started)"),
        owner: z.string().optional().describe("Project owner"),
        resources: z.string().optional().describe("Comma-separated resources"),
        dueDate: z.string().optional().describe("Due date (ISO format)"),
        target: z.string().optional().describe("Target date or milestone"),
        waitingOn: z.string().optional().describe("Who/what we're waiting on"),
        notes: z.string().optional().describe("Project notes"),
      }),
      execute: async ({ clientSlug, name, status, owner, resources, dueDate, target, waitingOn, notes }) => {
        const result = await addProject({
          clientSlug,
          name,
          status,
          owner,
          resources,
          dueDate,
          target,
          waitingOn,
          notes,
          updatedBy: userName,
        });

        if (!result.ok) {
          return { error: result.error };
        }

        if (result.data) {
          await safePostUpdate({
            clientName: result.data.clientName as string,
            projectName: result.data.projectName as string,
            updateText: `New project created`,
            updatedBy: userName,
          });
        }

        // Build detailed summary for the bot
        const details = [owner && `Owner: ${owner}`, resources && `Resources: ${resources}`, dueDate && `Due: ${dueDate}`].filter(Boolean).join(", ");
        const summary = `Created project '${name}' under ${result.data?.clientName ?? clientSlug}.${details ? ` ${details}.` : ""}`;
        return { result: summary };
      },
    }),

    update_project_field: tool({
      description:
        "Update a specific field on a project. This ACTUALLY changes the database field. Use for deadlines, owner, resources, name changes. Do NOT use add_update for field changes.",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug"),
        projectName: z.string().describe("Project name (fuzzy match)"),
        field: z.enum(["name", "dueDate", "owner", "resources", "waitingOn", "target", "notes"]).describe("Field to update"),
        newValue: z.string().describe("New value for the field"),
      }),
      execute: async ({ clientSlug, projectName, field, newValue }) => {
        const result = await updateProjectField({
          clientSlug,
          projectName,
          field,
          newValue,
          updatedBy: userName,
        });

        if (!result.ok) {
          return { error: result.error, available: result.available };
        }

        const cascaded = result.data?.cascadedItems as string[] | undefined;

        // Post to updates channel -- skip only true no-ops (no field change AND no cascades)
        if (result.data) {
          const changed = result.data.previousValue !== result.data.newValue;
          if (changed || cascaded?.length) {
            const updateText = changed
              ? `${field}: "${result.data.previousValue}" → "${result.data.newValue}"${cascaded?.length ? ` [+${cascaded.length} calendar items]` : ""}`
              : `Cascaded dueDate to ${cascaded!.length} calendar item(s): ${cascaded!.join(", ")}`;
            await safePostUpdate({
              clientName: result.data.clientName as string,
              projectName: result.data.projectName as string,
              updateText,
              updatedBy: userName,
            });
          }
        }

        if (!result.data) return { result: result.message };

        const d = result.data;
        const cascadeNote = cascaded?.length
          ? ` Also updated ${cascaded.length} linked calendar item(s): ${cascaded.join(", ")}.`
          : "";
        return { result: `Updated ${d.field} for ${d.projectName} (${d.clientName}). Was: "${d.previousValue}", now: "${d.newValue}".${cascadeNote}` };
      },
    }),

    create_week_item: tool({
      description: "Add a new item to the weekly calendar.",
      inputSchema: z.object({
        clientSlug: z.string().optional().describe("Client slug (if related to a client)"),
        projectName: z.string().optional().describe("Project name (fuzzy match)"),
        weekOf: z.string().default(currentMonday).describe(`ISO Monday date. Defaults to ${currentMonday}`),
        dayOfWeek: z.string().optional().describe("Day of the week (e.g. 'tuesday')"),
        date: z.string().optional().describe("Exact date (ISO format)"),
        title: z.string().describe("Week item title"),
        status: z.string().optional().describe("Status"),
        category: z.string().optional().describe("Category (delivery, review, kickoff, deadline, approval, launch)"),
        owner: z.string().optional().describe("Owner"),
        resources: z.string().optional().describe("Resources"),
        notes: z.string().optional().describe("Notes"),
      }),
      execute: async (params) => {
        const result = await createWeekItem({
          ...params,
          updatedBy: userName,
        });

        if (!result.ok) {
          return { error: result.error };
        }

        if (result.data?.clientName) {
          await safePostUpdate({
            clientName: result.data.clientName as string,
            updateText: `New week item: ${result.data.title}`,
            updatedBy: userName,
          });
        }

        return { result: result.message };
      },
    }),

    undo_last_change: tool({
      description:
        "Undo the most recent change made by this user. Use when someone says 'scratch that', 'undo', 'wait that's wrong', or 'change it back'.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await undoLastChange({ updatedBy: userName });

        if (!result.ok) {
          return { error: result.error };
        }

        if (result.data?.revertedFrom) {
          await safePostUpdate({
            clientName: "Undo",
            updateText: `Reverted: "${result.data.revertedFrom}" back to "${result.data.revertedTo}"`,
            updatedBy: userName,
          });
        }

        return { result: result.message };
      },
    }),

    get_recent_updates: tool({
      description:
        "Look up recent updates and changes. Use when someone asks 'what did I change?', 'what did I tell you about X?', or 'what happened with Bonterra this week?'",
      inputSchema: z.object({
        clientSlug: z.string().optional().describe("Filter by client slug"),
        since: z.string().optional().describe("ISO date to search from (default: 7 days ago)"),
        limit: z.number().optional().describe("Max results (default: 20)"),
      }),
      execute: async ({ clientSlug, since, limit }) => {
        return getRecentUpdates({
          updatedBy: userName,
          clientSlug,
          since,
          limit,
        });
      },
    }),

    update_week_item: tool({
      description: "Update a field on an existing week item.",
      inputSchema: z.object({
        weekOf: z.string().default(currentMonday).describe(`ISO Monday date. Defaults to ${currentMonday}`),
        weekItemTitle: z.string().describe("Week item title (fuzzy match)"),
        field: z.enum(["title", "status", "date", "dayOfWeek", "owner", "resources", "notes", "category"]).describe("Field to update"),
        newValue: z.string().describe("New value for the field"),
      }),
      execute: async ({ weekOf, weekItemTitle, field, newValue }) => {
        const result = await updateWeekItemField({
          weekOf,
          weekItemTitle,
          field,
          newValue,
          updatedBy: userName,
        });

        if (!result.ok) {
          return { error: result.error, available: result.available };
        }

        // Post to updates channel -- skip only true no-ops (no change AND no reverse cascade)
        if (result.data) {
          const changed = result.data.previousValue !== result.data.newValue;
          const reverseCascaded = result.data.reverseCascaded as boolean | undefined;
          if (changed || reverseCascaded) {
            const cascadeNote = reverseCascaded ? " (also updated project dueDate)" : "";
            await safePostUpdate({
              clientName: "Calendar",
              updateText: `Week item "${weekItemTitle}": ${field} updated${cascadeNote}`,
              updatedBy: userName,
            });
          }
        }

        return { result: result.message };
      },
    }),
  };
}
