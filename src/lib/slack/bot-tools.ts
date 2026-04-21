/** Runway Slack Bot Tools — thin wrappers around shared Runway operations. */

import { tool } from "ai";
import { z } from "zod";
import { postMutationUpdate } from "./updates-channel";
import {
  getClientsWithCounts,
  getProjectsFiltered,
  getPipelineData,
  getWeekItemsData,
  getPersonWorkload,
  getProjectStatus,
  updateProjectStatus,
  addProject,
  addUpdate,
  updateProjectField,
  createWeekItem,
  updateWeekItemField,
  undoLastChange,
  getRecentUpdates,
  deleteProject,
  deleteWeekItem,
  createPipelineItem,
  updatePipelineItem,
  deletePipelineItem,
  updateClientField,
  createTeamMember,
  updateTeamMember,
} from "@/lib/runway/operations";
import { getClientContactsStructured } from "@/lib/runway/operations-context";
import { getMonday, toISODateString } from "@/app/runway/date-utils";

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
      description: `Get calendar items for a given week, optionally filtered by person (owner OR resource), owner, or resource. Prefer the 'person' filter when the user asks what X has this week — it matches items where X is either accountable or doing the work. Use 'owner' only when they specifically ask who's accountable and 'resource' only when they specifically ask who's doing the work. The weekOf parameter defaults to the current week (${currentMonday}) — do not ask the user for a date.`,
      inputSchema: z.object({
        weekOf: z
          .string()
          .default(currentMonday)
          .describe(`ISO date of the Monday for the week to query. Defaults to ${currentMonday} (this week). Use this for "next week" or "last week" queries — never ask the user for a raw date.`),
        person: z
          .string()
          .optional()
          .describe("Filter to items where the person is owner OR resource (case-insensitive substring, e.g. 'Kathy'). Use this for plate queries."),
        owner: z
          .string()
          .optional()
          .describe("Filter by owner name only (person accountable, case-insensitive substring, e.g. 'Kathy')"),
        resource: z
          .string()
          .optional()
          .describe("Filter by resource name only (person doing the work, case-insensitive substring, e.g. 'Roz')"),
      }),
      execute: async ({ weekOf, owner, resource, person }) => {
        return getWeekItemsData(weekOf, owner, resource, person);
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
          await postMutationUpdate({
            result,
            fallbackClientName: clientSlug,
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
          await postMutationUpdate({
            result,
            fallbackClientName: clientSlug,
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

    get_project_status: tool({
      description:
        "Drill down on a single engagement. Returns a structured summary of one L1 project: owner, status, engagement type, contract range, who is blocking, in-flight and upcoming L2s, team roster, recent updates, and suggested next actions. Use when the user asks 'what's the deal with [client] / [project]' or 'how's [project] going' and you already know which project they mean. For 'what's on my plate' use get_person_workload instead.",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug (e.g. 'convergix')"),
        projectName: z.string().describe("Project name (fuzzy match, e.g. 'CDS Messaging')"),
      }),
      execute: async ({ clientSlug, projectName }) => {
        const result = await getProjectStatus({ clientSlug, projectName });
        if (!result.ok) return { error: result.error, available: result.available };
        return result.status;
      },
    }),

    get_client_contacts: tool({
      description:
        "Get client-side contacts for a given client. Powers 'who's holding things up at X?' questions.",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug (e.g. 'convergix')"),
      }),
      execute: async ({ clientSlug }) => {
        const contacts = await getClientContactsStructured(clientSlug);
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
          await postMutationUpdate({
            result,
            fallbackClientName: clientSlug,
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
            await postMutationUpdate({
              result,
              fallbackClientName: clientSlug,
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
        weekOf: z.string().default(currentMonday).describe(`ISO Monday date. Defaults to ${currentMonday}. If the user provides a specific date, calculate which Monday that date belongs to and use that as weekOf. Do not default to current Monday when a date is provided.`),
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
          await postMutationUpdate({
            result,
            fallbackClientName: "Calendar",
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
          await postMutationUpdate({
            result,
            fallbackClientName: "Undo",
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
            await postMutationUpdate({
              result,
              fallbackClientName: "Calendar",
              updateText: `Week item "${weekItemTitle}": ${field} updated${cascadeNote}`,
              updatedBy: userName,
            });
          }
        }

        return { result: result.message };
      },
    }),

    delete_project: tool({
      description: "Delete a project from a client. Use when someone says to remove or delete a project.",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug"),
        projectName: z.string().describe("Project name (fuzzy match)"),
      }),
      execute: async ({ clientSlug, projectName }) => {
        const result = await deleteProject({ clientSlug, projectName, updatedBy: userName });
        if (!result.ok) return { error: result.error, available: result.available };
        await postMutationUpdate({
          result,
          fallbackClientName: clientSlug,
          updateText: `Deleted project: ${projectName}`,
          updatedBy: userName,
        });
        return { result: result.message };
      },
    }),

    delete_week_item: tool({
      description: "Remove a week item from the calendar.",
      inputSchema: z.object({
        weekOf: z.string().default(currentMonday).describe(`ISO Monday date. Defaults to ${currentMonday}`),
        weekItemTitle: z.string().describe("Week item title (fuzzy match)"),
      }),
      execute: async ({ weekOf, weekItemTitle }) => {
        const result = await deleteWeekItem({ weekOf, weekItemTitle, updatedBy: userName });
        if (!result.ok) return { error: result.error, available: result.available };
        await postMutationUpdate({
          result,
          fallbackClientName: "Calendar",
          updateText: `Removed: ${weekItemTitle}`,
          updatedBy: userName,
        });
        return { result: result.message };
      },
    }),

    create_pipeline_item: tool({
      description: "Create a new pipeline item (SOW, new business opportunity) for a client.",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug"),
        name: z.string().describe("Pipeline item name"),
        owner: z.string().optional().describe("Owner"),
        status: z.string().optional().describe("Status (e.g. 'scoping', 'proposal', 'negotiation')"),
        estimatedValue: z.string().optional().describe("Estimated value"),
        waitingOn: z.string().optional().describe("Who/what is this waiting on"),
        notes: z.string().optional().describe("Notes"),
      }),
      execute: async ({ clientSlug, name, owner, status, estimatedValue, waitingOn, notes }) => {
        const result = await createPipelineItem({ clientSlug, name, owner, status, estimatedValue, waitingOn, notes, updatedBy: userName });
        if (!result.ok) return { error: result.error };
        await postMutationUpdate({
          result,
          fallbackClientName: clientSlug,
          updateText: `New pipeline item: ${name}`,
          updatedBy: userName,
        });
        return { result: result.message };
      },
    }),

    update_pipeline_item: tool({
      description: "Update a field on a pipeline item.",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug"),
        pipelineName: z.string().describe("Pipeline item name (fuzzy match)"),
        field: z.enum(["name", "owner", "status", "estimatedValue", "waitingOn", "notes"]).describe("Field to update"),
        newValue: z.string().describe("New value"),
      }),
      execute: async ({ clientSlug, pipelineName, field, newValue }) => {
        const result = await updatePipelineItem({ clientSlug, pipelineName, field, newValue, updatedBy: userName });
        if (!result.ok) return { error: result.error, available: result.available };
        await postMutationUpdate({
          result,
          fallbackClientName: clientSlug,
          updateText: `Pipeline ${pipelineName}: ${field} updated`,
          updatedBy: userName,
        });
        return { result: result.message };
      },
    }),

    delete_pipeline_item: tool({
      description: "Remove a pipeline item from a client.",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug"),
        pipelineName: z.string().describe("Pipeline item name (fuzzy match)"),
      }),
      execute: async ({ clientSlug, pipelineName }) => {
        const result = await deletePipelineItem({ clientSlug, pipelineName, updatedBy: userName });
        if (!result.ok) return { error: result.error, available: result.available };
        await postMutationUpdate({
          result,
          fallbackClientName: clientSlug,
          updateText: `Removed pipeline item: ${pipelineName}`,
          updatedBy: userName,
        });
        return { result: result.message };
      },
    }),

    update_client_field: tool({
      description: "Update a field on a client record (team, contractStatus, contacts, etc.).",
      inputSchema: z.object({
        clientSlug: z.string().describe("Client slug"),
        field: z.enum(["name", "team", "contractValue", "contractTerm", "contractStatus", "clientContacts", "nicknames"]).describe("Field to update"),
        newValue: z.string().describe("New value"),
      }),
      execute: async ({ clientSlug, field, newValue }) => {
        const result = await updateClientField({ clientSlug, field, newValue, updatedBy: userName });
        if (!result.ok) return { error: result.error };
        await postMutationUpdate({
          result,
          fallbackClientName: clientSlug,
          updateText: `${field} updated`,
          updatedBy: userName,
        });
        return { result: result.message };
      },
    }),

    create_team_member: tool({
      description: "Add a new team member to the system.",
      inputSchema: z.object({
        name: z.string().describe("Short name (e.g. 'Lane')"),
        firstName: z.string().optional().describe("First name"),
        fullName: z.string().optional().describe("Full name (e.g. 'Lane Davis')"),
        title: z.string().optional().describe("Job title"),
        roleCategory: z.string().optional().describe("Role category (am, pm, creative, dev, etc.)"),
      }),
      execute: async ({ name, firstName, fullName, title, roleCategory }) => {
        const result = await createTeamMember({ name, firstName, fullName, title, roleCategory, updatedBy: userName });
        if (!result.ok) return { error: result.error };
        await postMutationUpdate({
          result,
          fallbackClientName: "Team",
          updateText: `New member: ${name}`,
          updatedBy: userName,
        });
        return { result: result.message };
      },
    }),

    update_team_member: tool({
      description: "Update a field on a team member (title, isActive, accountsLed, etc.).",
      inputSchema: z.object({
        memberName: z.string().describe("Team member name (fuzzy match)"),
        field: z.enum(["title", "fullName", "slackUserId", "roleCategory", "accountsLed", "isActive", "nicknames", "channelPurpose"]).describe("Field to update"),
        newValue: z.string().describe("New value"),
      }),
      execute: async ({ memberName, field, newValue }) => {
        const result = await updateTeamMember({ memberName, field, newValue, updatedBy: userName });
        if (!result.ok) return { error: result.error, available: result.available };
        await postMutationUpdate({
          result,
          fallbackClientName: "Team",
          updateText: `${memberName}: ${field} updated`,
          updatedBy: userName,
        });
        return { result: result.message };
      },
    }),
  };
}
