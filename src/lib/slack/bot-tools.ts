/** Runway Slack Bot Tools — thin wrappers around shared Runway operations. */

import { tool } from "ai";
import { z } from "zod";
import { postMutationUpdate } from "./updates-channel";
import {
  getClientsWithCounts,
  getClientDetail,
  getProjectsFiltered,
  getPipelineData,
  getWeekItemsData,
  getWeekItemsInRange,
  getOrphanWeekItems,
  getPersonWorkload,
  getProjectStatus,
  findUpdates,
  getUpdateChain,
  getFlags,
  getDataHealth,
  getCurrentBatch,
  getBatchContents,
  getCascadeLog,
  getRowsChangedSince,
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
      description:
        "List clients. Each entry has { id, name, slug, contractValue, contractStatus, contractTerm, team, projectCount, updatedAt }. Pass includeProjects=true when you need each client's nested projects[] with dueDate, engagementType, contract dates, etc.",
      inputSchema: z.object({
        includeProjects: z
          .boolean()
          .optional()
          .describe("When true, include each client's nested projects[] array. Default false."),
      }),
      execute: async ({ includeProjects }) => getClientsWithCounts({ includeProjects }),
    }),

    get_projects: tool({
      description:
        "List L1 projects, optionally filtered. Each item has { id, name, client, status, category, owner, resources, waitingOn, notes, staleDays, dueDate, startDate, endDate, engagementType, contractStart, contractEnd, updatedAt }. Filter by clientSlug, owner substring, waitingOn substring, or engagementType (exact — pass '__null__' to match projects with NULL engagement_type).",
      inputSchema: z.object({
        clientSlug: z.string().optional().describe("Client slug (e.g. 'convergix')"),
        owner: z.string().optional().describe("Filter by owner name (case-insensitive substring, e.g. 'Kathy')"),
        waitingOn: z.string().optional().describe("Filter by waitingOn name (case-insensitive substring, e.g. 'Daniel')"),
        engagementType: z
          .string()
          .optional()
          .describe(
            "Exact engagement_type match (e.g. 'retainer', 'project', 'break-fix'). Pass '__null__' to narrow to projects with NULL engagement_type.",
          ),
      }),
      execute: async ({ clientSlug, owner, waitingOn, engagementType }) => {
        return getProjectsFiltered({ clientSlug, owner, waitingOn, engagementType });
      },
    }),

    get_pipeline: tool({
      description: "List all pipeline/unsigned SOWs",
      inputSchema: z.object({}),
      execute: async () => getPipelineData(),
    }),

    get_week_items: tool({
      description: `Get calendar items for a given week, optionally filtered by person (owner OR resource), owner, resource, status, or clientSlug. Prefer the 'person' filter when the user asks what X has this week — it matches items where X is either accountable or doing the work. Use 'owner' only when they specifically ask who's accountable and 'resource' only when they specifically ask who's doing the work. The weekOf parameter defaults to the current week (${currentMonday}) — do not ask the user for a date. All filters AND together.`,
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
        status: z
          .string()
          .optional()
          .describe(
            "Exact status match. Valid values: 'in-progress', 'blocked', 'at-risk', 'completed', 'canceled', 'scheduled'. 'scheduled' is the default for new L2s (PR 88 Chunk D) and also matches legacy NULL-status rows during the rollout backfill (status IS NULL OR status = 'scheduled').",
          ),
        clientSlug: z
          .string()
          .optional()
          .describe("Narrow to items whose client resolves from this slug (e.g. 'convergix')."),
      }),
      execute: async ({ weekOf, owner, resource, person, status, clientSlug }) => {
        return getWeekItemsData(weekOf, owner, resource, person, status, clientSlug);
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
        "Get a person's workload bucketed per the v4 convention. Returns { person, ownedProjects: { inProgress, awaitingClient, blocked, onHold, completed } (L1s they own only), weekItems: { overdue, thisWeek, nextWeek, later } (L2s they own OR resource on, stub-filtered to hide L2s under awaiting-client L1s), flags: { contractExpired (ClientRow[]), retainerRenewalDue (ProjectRow[]) }, totalProjects, totalActiveWeekItems }. Date buckets are Chicago-anchored. Powers 'what's on X's plate?' — present the date buckets first, roll up owned L1 count at end, surface flags at the top.",
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
        waitingOn: z.string().optional().describe("Who/what we're waiting on"),
        notes: z.string().optional().describe("Project notes"),
      }),
      execute: async ({ clientSlug, name, status, owner, resources, dueDate, waitingOn, notes }) => {
        const result = await addProject({
          clientSlug,
          name,
          status,
          owner,
          resources,
          dueDate,
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
        field: z.enum(["name", "dueDate", "owner", "resources", "waitingOn", "notes"]).describe("Field to update"),
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

    // ── Tier 2 reads — deep views + audit trail (PR #86 v4) ──

    get_client_detail: tool({
      description:
        "Deep view of a single client. Returns { id, name, slug, nicknames, contractValue, contractTerm, contractStatus, team, clientContacts, createdAt, updatedAt, projects[] (full v4 rows with dueDate, startDate, endDate, engagementType, contractStart, contractEnd), pipelineItems[], recentUpdates[] }. Use for 'what's the deal with [client]' where you want contract + pipeline + recent activity all at once.",
      inputSchema: z.object({
        slug: z.string().describe("Client slug (e.g. 'convergix')"),
        recentUpdatesLimit: z.number().optional().describe("Cap on recentUpdates[]. Default 20."),
      }),
      execute: async ({ slug, recentUpdatesLimit }) => {
        const result = await getClientDetail(slug, { recentUpdatesLimit });
        if (!result) return { error: `Client '${slug}' not found.` };
        return result;
      },
    }),

    get_orphan_week_items: tool({
      description:
        "List week items whose projectId is null — L2s that drifted off their parent L1. Returns raw WeekItemRow[]. Optional clientSlug narrows to one account.",
      inputSchema: z.object({
        clientSlug: z.string().optional().describe("Narrow to one client slug (optional)."),
      }),
      execute: async ({ clientSlug }) => getOrphanWeekItems(clientSlug),
    }),

    get_week_items_range: tool({
      description:
        "List week items whose start_date (fallback to legacy date) falls within [fromDate, toDate] inclusive. Returns raw WeekItemRow[]. Use for cross-week date drill-downs that don't fit the weekOf + person shape of get_week_items. Filters: clientSlug, owner substring, category (delivery, review, kickoff, deadline, approval, launch).",
      inputSchema: z.object({
        fromDate: z.string().describe("Inclusive lower bound — ISO YYYY-MM-DD."),
        toDate: z.string().describe("Inclusive upper bound — ISO YYYY-MM-DD."),
        clientSlug: z.string().optional().describe("Narrow to one client slug."),
        owner: z.string().optional().describe("Owner substring (case-insensitive)."),
        category: z.string().optional().describe("Exact category (delivery, review, kickoff, deadline, approval, launch)."),
      }),
      execute: async ({ fromDate, toDate, clientSlug, owner, category }) =>
        getWeekItemsInRange(fromDate, toDate, clientSlug, owner, category),
    }),

    find_updates: tool({
      description:
        "Audit-trail search over the updates table. Returns AuditUpdate[] with { id, clientName, projectName, updatedBy, updateType, summary, previousValue, newValue, batchId, triggeredByUpdateId, createdAt }. All filters optional. Use this (not get_recent_updates) when you need the update `id` or `triggeredByUpdateId` to follow a cascade or reconcile a batch.",
      inputSchema: z.object({
        since: z.string().optional().describe("Inclusive lower bound on createdAt (ISO)."),
        until: z.string().optional().describe("Inclusive upper bound on createdAt (ISO)."),
        clientSlug: z.string().optional().describe("Narrow to one client slug."),
        updatedBy: z.string().optional().describe("Substring match on updates.updated_by."),
        updateType: z.string().optional().describe("Exact updateType (e.g. 'status-change', 'cascade-status-change')."),
        batchId: z.string().optional().describe("Exact match on updates.batch_id."),
        projectName: z.string().optional().describe("Substring match against linked project name."),
        limit: z.number().optional().describe("Cap on rows. Default 100."),
      }),
      execute: async (params) => findUpdates(params),
    }),

    get_update_chain: tool({
      description:
        "Walk the cascade audit linkage for a given update id. Returns { root, chain: AuditUpdate[] } — root is the ancestor with no triggeredByUpdateId, chain is every row from root to leaf ordered by createdAt ascending. Use to answer 'why did X change?' by following the trigger chain.",
      inputSchema: z.object({
        updateId: z.string().describe("updates.id to follow. Usually from find_updates or a mutation response's data.auditId."),
      }),
      execute: async ({ updateId }) => getUpdateChain(updateId),
    }),

    // ── Tier 3 reads — observability & flags (PR #86 v4) ──

    get_flags: tool({
      description:
        "Aggregate surface for every soft flag the board raises: past-end L2s, stale L1s, waitingOn bottlenecks, today/tomorrow deadlines, resource conflicts, retainer renewals, expired contracts. Returns { flags: RunwayFlag[], retainerRenewalDue: RetainerRenewalPill[], contractExpired: ContractExpiredPill[] }. Narrow via clientSlug or personName.",
      inputSchema: z.object({
        clientSlug: z.string().optional().describe("Narrow to one client slug."),
        personName: z.string().optional().describe("Narrow to flags where owner/waitingOn matches (substring)."),
      }),
      execute: async ({ clientSlug, personName }) => getFlags({ clientSlug, personName }),
    }),

    get_data_health: tool({
      description:
        "Health snapshot of the Runway DB. Returns { totals, orphans: { weekItemsWithoutProject, projectsWithoutClient, updatesWithDanglingTriggeredBy }, stale: { staleProjects, pastEndL2s }, batch: { activeBatchId, distinctBatchIdsLast7Days }, lastUpdateAt }. Use before/after cleanup batches or when asked 'is everything linked correctly?'",
      inputSchema: z.object({}),
      execute: async () => getDataHealth(),
    }),

    get_current_batch: tool({
      description:
        "Return the currently-active batch for THIS process. Returns { active: false } when not batching, otherwise { active: true, batchId, itemCount, startedAt, startedBy, mostRecentAt }. Batch state is per-process, not persisted.",
      inputSchema: z.object({}),
      execute: async () => getCurrentBatch(),
    }),

    get_batch_contents: tool({
      description:
        "Retrieve every audit row tagged with the given batchId, grouped by (client, project) and sorted within each group by createdAt asc. Returns { batchId, totalUpdates, groups: [{ clientName, projectName, updates }] }. Use to review what a batch did before publishing or reconcile after.",
      inputSchema: z.object({
        batchId: z.string().describe("Batch id to inspect."),
      }),
      execute: async ({ batchId }) => getBatchContents(batchId),
    }),

    get_cascade_log: tool({
      description:
        "Recent cascade-generated audit rows within a time window, grouped by parent update id. Returns { windowMinutes, since, totalCascadeRows, groups: [{ parentUpdateId, parent, children }] }. Default window is 60 minutes. Use to see which cascades fired recently or trace cascade fan-out.",
      inputSchema: z.object({
        windowMinutes: z.number().optional().describe("Look-back window in minutes. Default 60."),
      }),
      execute: async ({ windowMinutes }) => getCascadeLog(windowMinutes),
    }),

    get_rows_changed_since: tool({
      description:
        "Drift detection. Return rows in projects / weekItems / clients / pipelineItems whose updated_at is >= `since` (inclusive ISO timestamp). Returns { since, counts, projects, weekItems, clients, pipelineItems } with full raw columns. Use to answer 'what changed since <timestamp>?' after a cleanup batch or to detect drift from a known snapshot. Narrow with `tables` or `clientSlug`.",
      inputSchema: z.object({
        since: z.string().describe("ISO timestamp. Inclusive >= comparison against each table's updated_at."),
        tables: z
          .array(z.enum(["projects", "weekItems", "clients", "pipelineItems"]))
          .optional()
          .describe("Optional subset of tables to query. Default: all four."),
        clientSlug: z
          .string()
          .optional()
          .describe("Narrow to one client (client_id match for scoped tables, slug match for clients)."),
      }),
      execute: async ({ since, tables, clientSlug }) =>
        getRowsChangedSince(since, { tables, clientSlug }),
    }),
  };
}
