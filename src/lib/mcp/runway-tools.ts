/** Runway MCP Tool Registrations — thin formatting layer over shared operations. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getClientsWithCounts,
  getClientDetail,
  getProjectsFiltered,
  getWeekItemsData,
  getWeekItemsByProject,
  getWeekItemsInRange,
  getOrphanWeekItems,
  getPersonWorkload,
  getProjectStatus,
  getPipelineData,
  getUpdatesData,
  findUpdates,
  getUpdateChain,
  getTeamMembersData,
  getClientContacts,
  getFlags,
  getDataHealth,
  getCurrentBatch,
  getBatchContents,
  getCascadeLog,
  updateProjectStatus,
  addProject,
  addUpdate,
  updateProjectField,
  createWeekItem,
  updateWeekItemField,
  undoLastChange,
  deleteProject,
  deleteWeekItem,
  createPipelineItem,
  updatePipelineItem,
  deletePipelineItem,
  updateClientField,
  createTeamMember,
  updateTeamMember,
  setBatchId,
  getBatchId,
} from "@/lib/runway/operations";
import { postMutationUpdate } from "@/lib/slack/updates-channel";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function textMessage(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}

function operationResultMessage(result: { ok: boolean; message?: string; error?: string }) {
  return textMessage(result.ok ? result.message! : result.error!);
}

/**
 * Mutation tool response helper — returns the human-readable message AND, when
 * a mutation produced structured data (cascadeDetail, reverseCascadeDetail,
 * auditId, before/after values), a JSON-encoded summary so callers can parse
 * the cascade outcome without scraping prose.
 *
 * Shape on success:
 *   "<message>\n\n<JSON.stringify({ data })>"
 * The JSON block is omitted when data is undefined. Error responses keep the
 * legacy plain-error-text contract. v4 convention (2026-04-21 / PR #86).
 */
function mutationResult(result: {
  ok: boolean;
  message?: string;
  error?: string;
  available?: string[];
  data?: Record<string, unknown>;
}) {
  if (!result.ok) return textMessage(result.error!);
  if (!result.data) return textMessage(result.message!);
  const payload = { message: result.message, data: result.data };
  return textResult(payload);
}

export function registerRunwayTools(server: McpServer) {
  // ── Read tools ──────────────────────────────────────────

  server.tool(
    "get_clients",
    "List all clients. Returns objects with { id, name, slug, contractValue, contractStatus, contractTerm, team, projectCount, updatedAt }. Pass includeProjects=true to include a nested `projects` array with each client's full v4-enriched project rows (id, name, client, status, category, owner, resources, waitingOn, target, notes, staleDays, dueDate, startDate, endDate, engagementType, contractStart, contractEnd, updatedAt).",
    {
      includeProjects: z
        .boolean()
        .optional()
        .describe("When true, include each client's nested projects[] array. Default false."),
    },
    async ({ includeProjects }) => textResult(await getClientsWithCounts({ includeProjects })),
  );

  server.tool("get_projects", "List projects, optionally filtered by client, status, owner, or waitingOn", {
    clientSlug: z.string().optional().describe("Filter by client slug (e.g. 'convergix')"),
    status: z.string().optional().describe("Filter by status (e.g. 'in-production', 'blocked')"),
    owner: z.string().optional().describe("Filter by owner name (case-insensitive substring, e.g. 'Kathy')"),
    waitingOn: z.string().optional().describe("Filter by waitingOn name (case-insensitive substring, e.g. 'Daniel')"),
  }, async ({ clientSlug, status, owner, waitingOn }) => textResult(await getProjectsFiltered({ clientSlug, status, owner, waitingOn })));

  server.tool("get_week_items", "Get calendar items for a specific week, optionally filtered by person (owner OR resource), owner, or resource", {
    weekOf: z.string().optional().describe("ISO date of the Monday (e.g. '2026-04-06')"),
    owner: z.string().optional().describe("Filter by owner name only (case-insensitive substring, e.g. 'Kathy')"),
    resource: z.string().optional().describe("Filter by resource name only (case-insensitive substring, e.g. 'Roz')"),
    person: z.string().optional().describe("Filter where the person is owner OR resource (use this for plate queries, e.g. 'Kathy')"),
  }, async ({ weekOf, owner, resource, person }) => textResult(await getWeekItemsData(weekOf, owner, resource, person)));

  server.tool("get_week_items_by_project", "List all non-completed week items (L2s) under a given project id. Use for drill-down 'what's left on Convergix / CDS?' queries.", {
    projectId: z.string().describe("Project id (L1 id)"),
  }, async ({ projectId }) => textResult(await getWeekItemsByProject(projectId)));

  server.tool("get_pipeline", "List all pipeline/unsigned SOWs", {},
    async () => textResult(await getPipelineData()));

  server.tool(
    "get_updates",
    "Get recent update history. Returns an array of { client, updatedBy, updateType, previousValue, newValue, summary, createdAt }. Filter by clientSlug, a createdAt range via since/until (ISO), batchId (audit tag), updateType (exact), or projectName (substring).",
    {
      clientSlug: z.string().optional().describe("Filter by client slug"),
      limit: z.number().optional().default(20).describe("Max updates to return (default 20)"),
      since: z
        .string()
        .optional()
        .describe("ISO lower bound on createdAt (inclusive). e.g. '2026-04-01' or full ISO timestamp."),
      until: z
        .string()
        .optional()
        .describe("ISO upper bound on createdAt (inclusive)."),
      batchId: z
        .string()
        .optional()
        .describe("Exact match on updates.batch_id. Useful for inspecting a prior batch."),
      updateType: z
        .string()
        .optional()
        .describe(
          "Exact match on updates.update_type (e.g. 'status-change', 'field-change', 'cascade-status-change', 'cascade-date-change').",
        ),
      projectName: z
        .string()
        .optional()
        .describe("Case-insensitive substring match against the linked project name."),
    },
    async ({ clientSlug, limit, since, until, batchId, updateType, projectName }) =>
      textResult(
        await getUpdatesData({ clientSlug, limit, since, until, batchId, updateType, projectName }),
      ),
  );

  server.tool("get_team_members", "List team members, roles, and what they track", {},
    async () => textResult(await getTeamMembersData()));

  server.tool("get_person_workload", "Get all week items and projects assigned to a person, grouped by client", {
    personName: z.string().describe("Person's name (e.g. 'Kathy', 'Roz')"),
  }, async ({ personName }) => textResult(await getPersonWorkload(personName)));

  server.tool("get_project_status", "Drill down on a single engagement. Returns structured data: owner, status, engagement type, contract range, blockers, in-flight and upcoming L2s, team, recent updates, suggested actions.", {
    clientSlug: z.string().describe("Client slug (e.g. 'convergix')"),
    projectName: z.string().describe("Project name (fuzzy match)"),
  }, async ({ clientSlug, projectName }) => {
    const result = await getProjectStatus({ clientSlug, projectName });
    if (!result.ok) return textMessage(result.error);
    return textResult(result.status);
  });

  server.tool("get_client_contacts", "Get client-side contacts for a given client",
    { clientSlug: z.string().describe("Client slug") },
    async ({ clientSlug }) => {
      const result = await getClientContacts(clientSlug);
      if (!result) return textMessage(`Client '${clientSlug}' not found.`);
      return textResult(result);
    });

  // ── Tier 2 reads — deep views + audit drill-downs ───────

  server.tool(
    "get_client_detail",
    "Deep view of a single client. Returns { id, name, slug, nicknames, contractValue, contractTerm, contractStatus, team, clientContacts, createdAt, updatedAt, projects[] (full v4 rows with dueDate/startDate/endDate/engagementType/contractStart/contractEnd), pipelineItems[], recentUpdates[] (id, projectId, updatedBy, updateType, summary, previousValue, newValue, batchId, createdAt) }. Returns an error message when the slug is unknown.",
    {
      slug: z.string().describe("Client slug (e.g. 'convergix')"),
      recentUpdatesLimit: z
        .number()
        .optional()
        .describe("Cap on recentUpdates[]. Default 20."),
    },
    async ({ slug, recentUpdatesLimit }) => {
      const result = await getClientDetail(slug, { recentUpdatesLimit });
      if (!result) return textMessage(`Client '${slug}' not found.`);
      return textResult(result);
    },
  );

  server.tool(
    "get_orphan_week_items",
    "List week items whose projectId is null (unlinked L2s). Returns raw WeekItemRow[] with id, title, weekOf, date/startDate/endDate, owner, resources, status, category, clientId, etc. Useful for finding L2s that drifted off their parent L1 during imports or cascades.",
    {
      clientSlug: z
        .string()
        .optional()
        .describe("Narrow to orphan L2s for a single client slug (optional)."),
    },
    async ({ clientSlug }) => textResult(await getOrphanWeekItems(clientSlug)),
  );

  server.tool(
    "get_week_items_range",
    "List week items whose start_date (fallback to legacy `date`) falls within [fromDate, toDate] inclusive. Returns raw WeekItemRow[]. Filters: clientSlug (slug), owner (substring on owner column), category (exact enum match: delivery, review, kickoff, deadline, approval, launch).",
    {
      fromDate: z.string().describe("Inclusive lower bound — ISO YYYY-MM-DD."),
      toDate: z.string().describe("Inclusive upper bound — ISO YYYY-MM-DD."),
      clientSlug: z.string().optional().describe("Narrow to one client slug."),
      owner: z
        .string()
        .optional()
        .describe("Owner name substring (case-insensitive)."),
      category: z
        .string()
        .optional()
        .describe("Exact category (delivery, review, kickoff, deadline, approval, launch)."),
    },
    async ({ fromDate, toDate, clientSlug, owner, category }) =>
      textResult(await getWeekItemsInRange(fromDate, toDate, clientSlug, owner, category)),
  );

  server.tool(
    "find_updates",
    "Audit-trail search over the updates table. Returns AuditUpdate[] with { id, clientName, projectName, updatedBy, updateType, summary, previousValue, newValue, batchId, triggeredByUpdateId, createdAt }. All filters optional — lets callers walk the audit log by time window, batch, update type, person, or project name. Use this (not get_updates) when you need the update `id` or `triggeredByUpdateId` to follow a cascade.",
    {
      since: z.string().optional().describe("Inclusive lower bound on createdAt (ISO)."),
      until: z.string().optional().describe("Inclusive upper bound on createdAt (ISO)."),
      clientSlug: z.string().optional().describe("Narrow to one client slug."),
      updatedBy: z
        .string()
        .optional()
        .describe("Case-insensitive substring match on updates.updated_by."),
      updateType: z
        .string()
        .optional()
        .describe(
          "Exact match (e.g. 'status-change', 'field-change', 'cascade-status-change', 'cascade-date-change').",
        ),
      batchId: z.string().optional().describe("Exact match on updates.batch_id."),
      projectName: z
        .string()
        .optional()
        .describe("Case-insensitive substring match against the linked project's name."),
      limit: z.number().optional().describe("Hard cap on returned rows. Default 100."),
    },
    async (params) => textResult(await findUpdates(params)),
  );

  server.tool(
    "get_update_chain",
    "Walk the cascade audit linkage for a given update id. Returns { root: AuditUpdate | null, chain: AuditUpdate[] } — root is the ancestor with no triggeredByUpdateId, chain is every row from root to leaf ordered by createdAt ascending. Returns { root: null, chain: [] } when the id is missing.",
    {
      updateId: z
        .string()
        .describe("updates.id to follow. Typically obtained from find_updates or a mutation response's data.auditId."),
    },
    async ({ updateId }) => textResult(await getUpdateChain(updateId)),
  );

  // ── Tier 3 reads — observability & flags ────────────────

  server.tool(
    "get_flags",
    "Aggregate surface for every soft flag the board and bot raise: past-end L2s, stale L1s, waitingOn bottlenecks, today/tomorrow deadlines, resource conflicts, retainer renewals, expired contracts. Returns { flags: RunwayFlag[], retainerRenewalDue: RetainerRenewalPill[], contractExpired: ContractExpiredPill[] }. Narrow to one client via clientSlug or one person via personName (substring match on owner/waitingOn).",
    {
      clientSlug: z.string().optional().describe("Narrow to one client slug (matches Account.slug)."),
      personName: z
        .string()
        .optional()
        .describe("Narrow to flags where the owner or waitingOn person matches (substring)."),
    },
    async ({ clientSlug, personName }) => textResult(await getFlags({ clientSlug, personName })),
  );

  server.tool(
    "get_data_health",
    "Health snapshot of the Runway DB. Returns { totals: { projects, weekItems, clients, updates, pipelineItems }, orphans: { weekItemsWithoutProject, projectsWithoutClient, updatesWithDanglingTriggeredBy }, stale: { staleProjects (>=14d, excl. completed/on-hold), pastEndL2s (in-progress past end_date) }, batch: { activeBatchId, distinctBatchIdsLast7Days }, lastUpdateAt }. Use before/after cleanup batches to measure drift.",
    {},
    async () => textResult(await getDataHealth()),
  );

  server.tool(
    "get_current_batch",
    "Return the currently-active batch for THIS process. Returns { active: false } when not batching, otherwise { active: true, batchId, itemCount, startedAt, startedBy, mostRecentAt }. Batch state lives in module memory (not the DB), so this reflects the current request's scope.",
    {},
    async () => textResult(await getCurrentBatch()),
  );

  server.tool(
    "get_batch_contents",
    "Retrieve every audit row tagged with the given batchId, grouped by (client, project) and sorted within each group by createdAt ascending. Returns { batchId, totalUpdates, groups: [{ clientName, projectName, updates: BatchUpdateEntry[] }] }. Use to review what a batch did before/after publishing.",
    { batchId: z.string().describe("Batch id to inspect (e.g. 'cleanup-2026-04-18').") },
    async ({ batchId }) => textResult(await getBatchContents(batchId)),
  );

  server.tool(
    "get_cascade_log",
    "Recent cascade-generated audit rows within a time window, grouped by parent update id. Returns { windowMinutes, since, totalCascadeRows, groups: [{ parentUpdateId, parent, children: CascadeChildEntry[] }] }. Children are cascade-* updateType rows ordered by createdAt asc; groups ordered by most-recent child desc.",
    {
      windowMinutes: z
        .number()
        .optional()
        .describe("Look-back window in minutes. Default 60."),
    },
    async ({ windowMinutes }) => textResult(await getCascadeLog(windowMinutes)),
  );

  // ── Mutation tools — project ────────────────────────────

  server.tool(
    "update_project_status",
    "Change a project's status and log the update. On success returns { message, data } where data includes { clientName, projectName, previousStatus, newStatus, cascadedItems (string[] — legacy), cascadeDetail ([{ itemId, itemTitle, field, previousValue, newValue, auditId }]), auditId }. Status changes to terminal statuses (completed, canceled, on-hold) cascade to linked L2 week items.",
    {
      clientSlug: z.string().describe("Client slug (e.g. 'convergix')"),
      projectName: z.string().describe("Project name (fuzzy match)"),
      newStatus: z.string().describe("New status value"),
      updatedBy: z.string().default("mcp").describe("Person making the update"),
      notes: z.string().optional().describe("Additional context"),
    },
    async (params) => {
      const result = await updateProjectStatus(params);
      if (result.ok && !getBatchId()) {
        await postMutationUpdate({
          result,
          fallbackClientName: params.clientSlug,
          projectName: result.data?.projectName as string,
          updateText: `Status: ${result.data?.previousStatus} → ${result.data?.newStatus}`,
          updatedBy: params.updatedBy,
        });
      }
      return mutationResult(result);
    },
  );

  server.tool(
    "update_project_field",
    "Update a specific field on a project. On success returns { message, data } where data includes { clientName, projectName, field, previousValue, newValue, cascadedItems, cascadeDetail ([{ itemId, itemTitle, field: 'date', previousValue, newValue, auditId }] — only populated when field='dueDate'), auditId }.",
    {
      clientSlug: z.string().describe("Client slug"),
      projectName: z.string().describe("Project name (fuzzy match)"),
      field: z.enum(["name", "dueDate", "owner", "resources", "waitingOn", "target", "notes"]).describe("Field to update"),
      newValue: z.string().describe("New value"),
      updatedBy: z.string().default("mcp").describe("Person making the update"),
    },
    async (params) => {
      const result = await updateProjectField(params);
      if (result.ok && !getBatchId()) {
        await postMutationUpdate({
          result,
          fallbackClientName: params.clientSlug,
          projectName: result.data?.projectName as string,
          updateText: `${params.field} updated`,
          updatedBy: params.updatedBy,
        });
      }
      return mutationResult(result);
    },
  );

  server.tool("delete_project", "Delete a project from a client", {
    clientSlug: z.string().describe("Client slug"),
    projectName: z.string().describe("Project name (fuzzy match)"),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await deleteProject(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: params.clientSlug,
        updateText: `Deleted project: ${params.projectName}`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  server.tool("add_project", "Create a new project under a client", {
    clientSlug: z.string().describe("Client slug"),
    name: z.string().describe("Project name"),
    status: z.string().optional().default("not-started"),
    category: z.string().optional().default("active"),
    owner: z.string().optional(),
    notes: z.string().optional(),
    updatedBy: z.string().default("mcp").describe("Person adding the project"),
  }, async (params) => {
    const result = await addProject(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: params.clientSlug,
        updateText: `New project: ${params.name}`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  // ── Mutation tools — week items ─────────────────────────

  server.tool("create_week_item", "Add a new item to the weekly calendar", {
    clientSlug: z.string().optional().describe("Client slug (if related to a client)"),
    projectName: z.string().optional().describe("Project name (fuzzy match)"),
    weekOf: z.string().optional().describe("ISO Monday date (auto-calculated from date if omitted)"),
    date: z.string().optional().describe("Exact date (ISO format)"),
    dayOfWeek: z.string().optional().describe("Day of the week (e.g. 'tuesday')"),
    title: z.string().describe("Week item title"),
    status: z.string().optional(),
    category: z.string().optional().describe("Category (delivery, review, kickoff, deadline, approval, launch)"),
    owner: z.string().optional(),
    resources: z.string().optional(),
    notes: z.string().optional(),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await createWeekItem(params);
    if (result.ok && !getBatchId() && result.data?.clientName) {
      await postMutationUpdate({
        result,
        fallbackClientName: params.clientSlug ?? "Calendar",
        updateText: `New week item: ${params.title}`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  server.tool(
    "update_week_item",
    "Update a field on an existing week item. On success returns { message, data } where data includes { weekItemTitle, field, previousValue, newValue, clientName, reverseCascaded (boolean — legacy), reverseCascadeDetail ({ projectId, projectName, field: 'dueDate', previousDueDate, newDueDate, auditId } | null) for deadline-category date changes that back-propagate to the parent project, auditId }.",
    {
      weekOf: z.string().describe("ISO Monday date"),
      weekItemTitle: z.string().describe("Week item title (fuzzy match)"),
      field: z.enum(["title", "status", "date", "dayOfWeek", "owner", "resources", "notes", "category"]).describe("Field to update"),
      newValue: z.string().describe("New value"),
      updatedBy: z.string().default("mcp").describe("Person making the update"),
    },
    async (params) => {
      const result = await updateWeekItemField(params);
      if (!getBatchId()) {
        await postMutationUpdate({
          result,
          fallbackClientName: "Calendar",
          updateText: `Week item "${params.weekItemTitle}": ${params.field} updated`,
          updatedBy: params.updatedBy,
        });
      }
      return mutationResult(result);
    },
  );

  server.tool("delete_week_item", "Remove a week item from the calendar", {
    weekOf: z.string().optional().describe("ISO Monday date"),
    weekItemTitle: z.string().optional().describe("Week item title (fuzzy match)"),
    id: z.string().optional().describe("Direct week item ID"),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await deleteWeekItem(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: "Calendar",
        updateText: `Removed: ${params.weekItemTitle ?? params.id}`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  // ── Mutation tools — pipeline ───────────────────────────

  server.tool("create_pipeline_item", "Create a new pipeline item (SOW, new business opportunity)", {
    clientSlug: z.string().describe("Client slug"),
    name: z.string().describe("Pipeline item name"),
    owner: z.string().optional(),
    status: z.string().optional().describe("Status (scoping, proposal, negotiation, signed)"),
    estimatedValue: z.string().optional(),
    waitingOn: z.string().optional(),
    notes: z.string().optional(),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await createPipelineItem(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: params.clientSlug,
        updateText: `New pipeline item: ${params.name}`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  server.tool("update_pipeline_item", "Update a field on a pipeline item", {
    clientSlug: z.string().describe("Client slug"),
    pipelineName: z.string().describe("Pipeline item name (fuzzy match)"),
    field: z.enum(["name", "owner", "status", "estimatedValue", "waitingOn", "notes"]).describe("Field to update"),
    newValue: z.string().describe("New value"),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await updatePipelineItem(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: params.clientSlug,
        updateText: `Pipeline ${params.pipelineName}: ${params.field} updated`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  server.tool("delete_pipeline_item", "Remove a pipeline item", {
    clientSlug: z.string().describe("Client slug"),
    pipelineName: z.string().describe("Pipeline item name (fuzzy match)"),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await deletePipelineItem(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: params.clientSlug,
        updateText: `Removed pipeline item: ${params.pipelineName}`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  // ── Mutation tools — client ─────────────────────────────

  server.tool("update_client_field", "Update a field on a client record", {
    clientSlug: z.string().describe("Client slug"),
    field: z.enum(["name", "team", "contractValue", "contractTerm", "contractStatus", "clientContacts", "nicknames"]).describe("Field to update"),
    newValue: z.string().describe("New value"),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await updateClientField(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: params.clientSlug,
        updateText: `${params.field} updated`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  // ── Mutation tools — team ───────────────────────────────

  server.tool("create_team_member", "Add a new team member", {
    name: z.string().describe("Short name (e.g. 'Lane')"),
    firstName: z.string().optional(),
    fullName: z.string().optional().describe("Full name (e.g. 'Lane Davis')"),
    title: z.string().optional().describe("Job title"),
    roleCategory: z.string().optional().describe("Role category (am, pm, creative, dev)"),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await createTeamMember(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: "Team",
        updateText: `New member: ${params.name}`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  server.tool("update_team_member", "Update a field on a team member", {
    memberName: z.string().describe("Team member name (fuzzy match)"),
    field: z.enum(["title", "fullName", "slackUserId", "roleCategory", "accountsLed", "isActive", "nicknames", "channelPurpose"]).describe("Field to update"),
    newValue: z.string().describe("New value"),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await updateTeamMember(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: "Team",
        updateText: `${params.memberName}: ${params.field} updated`,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  // ── Mutation tools — notes & undo ───────────────────────

  server.tool("add_update", "Log a free-form update for a client or project", {
    clientSlug: z.string().describe("Client slug"),
    projectName: z.string().optional().describe("Project name (fuzzy match)"),
    summary: z.string().describe("The update text"),
    updatedBy: z.string().default("mcp").describe("Person making the update"),
  }, async (params) => {
    const result = await addUpdate(params);
    if (!getBatchId()) {
      await postMutationUpdate({
        result,
        fallbackClientName: params.clientSlug,
        projectName: params.projectName,
        updateText: params.summary,
        updatedBy: params.updatedBy,
      });
    }
    return operationResultMessage(result);
  });

  server.tool("undo_last_change", "Undo the most recent change", {
    updatedBy: z.string().default("mcp").describe("Person who made the change to undo"),
  }, async (params) => {
    const result = await undoLastChange(params);
    return operationResultMessage(result);
  });

  // ── Batch mode ──────────────────────────────────────────

  server.tool("set_batch_mode", "Enable/disable batch mode. When active, Slack notifications are suppressed and audit records are tagged with the batchId.", {
    batchId: z.string().nullable().describe("Batch ID to set, or null to clear"),
  }, async ({ batchId }) => {
    setBatchId(batchId);
    return textMessage(batchId ? `Batch mode enabled: ${batchId}` : "Batch mode disabled");
  });
}
