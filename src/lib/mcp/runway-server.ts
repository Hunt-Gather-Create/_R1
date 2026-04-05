/**
 * Runway MCP Server — Tool definitions and handlers
 *
 * Central access layer for all Runway read/write operations.
 * Clients: Slack bot, Claude Code, Open Brain
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRunwayDb } from "@/lib/db/runway";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
  updates,
  teamMembers,
} from "@/lib/db/runway-schema";
import { eq, desc, asc } from "drizzle-orm";
import { createHash } from "crypto";

function idempotencyKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 25);
}

export function createRunwayMcpServer(): McpServer {
  const server = new McpServer({
    name: "runway",
    version: "1.0.0",
  });

  // ── Read Tools ────────────────────────────────────────────

  server.tool("get_clients", "List all clients with project counts", {}, async () => {
    const db = getRunwayDb();
    const allClients = await db.select().from(clients).orderBy(asc(clients.name));
    const allProjects = await db.select().from(projects);

    const countByClient = new Map<string, number>();
    for (const p of allProjects) {
      countByClient.set(p.clientId, (countByClient.get(p.clientId) ?? 0) + 1);
    }

    const result = allClients.map((c) => ({
      name: c.name,
      slug: c.slug,
      contractValue: c.contractValue,
      contractStatus: c.contractStatus,
      contractTerm: c.contractTerm,
      team: c.team,
      projectCount: countByClient.get(c.id) ?? 0,
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  });

  server.tool(
    "get_projects",
    "List projects, optionally filtered by client slug or status",
    {
      clientSlug: z.string().optional().describe("Filter by client slug (e.g. 'convergix')"),
      status: z.string().optional().describe("Filter by status (e.g. 'in-production', 'blocked')"),
    },
    async ({ clientSlug, status }) => {
      const db = getRunwayDb();
      const allClients = await db.select().from(clients);
      const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
      const clientBySlug = new Map(allClients.map((c) => [c.slug, c]));

      let projectList = await db
        .select()
        .from(projects)
        .orderBy(asc(projects.sortOrder));

      if (clientSlug) {
        const client = clientBySlug.get(clientSlug);
        if (client) {
          projectList = projectList.filter((p) => p.clientId === client.id);
        }
      }

      if (status) {
        projectList = projectList.filter((p) => p.status === status);
      }

      const result = projectList.map((p) => ({
        name: p.name,
        client: clientNameById.get(p.clientId) ?? "Unknown",
        status: p.status,
        category: p.category,
        owner: p.owner,
        waitingOn: p.waitingOn,
        target: p.target,
        notes: p.notes,
        staleDays: p.staleDays,
      }));

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_week_items",
    "Get calendar items for a specific week (or all weeks if no weekOf provided)",
    {
      weekOf: z.string().optional().describe("ISO date of the Monday (e.g. '2026-04-06')"),
    },
    async ({ weekOf }) => {
      const db = getRunwayDb();
      const allClients = await db.select().from(clients);
      const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

      let items;
      if (weekOf) {
        items = await db
          .select()
          .from(weekItems)
          .where(eq(weekItems.weekOf, weekOf))
          .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));
      } else {
        items = await db
          .select()
          .from(weekItems)
          .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));
      }

      const result = items.map((item) => ({
        date: item.date,
        dayOfWeek: item.dayOfWeek,
        title: item.title,
        account: item.clientId ? clientNameById.get(item.clientId) : null,
        category: item.category,
        owner: item.owner,
        notes: item.notes,
      }));

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool("get_pipeline", "List all pipeline/unsigned SOWs", {}, async () => {
    const db = getRunwayDb();
    const allClients = await db.select().from(clients);
    const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

    const items = await db
      .select()
      .from(pipelineItems)
      .orderBy(asc(pipelineItems.sortOrder));

    const result = items.map((item) => ({
      account: item.clientId ? clientNameById.get(item.clientId) : null,
      name: item.name,
      status: item.status,
      estimatedValue: item.estimatedValue,
      waitingOn: item.waitingOn,
      notes: item.notes,
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  });

  server.tool(
    "get_updates",
    "Get recent update history, optionally filtered by client slug",
    {
      clientSlug: z.string().optional().describe("Filter by client slug"),
      limit: z.number().optional().default(20).describe("Max updates to return"),
    },
    async ({ clientSlug, limit }) => {
      const db = getRunwayDb();
      const allClients = await db.select().from(clients);
      const clientBySlug = new Map(allClients.map((c) => [c.slug, c]));
      const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

      let updateList = await db
        .select()
        .from(updates)
        .orderBy(desc(updates.createdAt))
        .limit(limit);

      if (clientSlug) {
        const client = clientBySlug.get(clientSlug);
        if (client) {
          updateList = updateList.filter((u) => u.clientId === client.id);
        }
      }

      const result = updateList.map((u) => ({
        client: u.clientId ? clientNameById.get(u.clientId) : null,
        updatedBy: u.updatedBy,
        updateType: u.updateType,
        previousValue: u.previousValue,
        newValue: u.newValue,
        summary: u.summary,
        createdAt: u.createdAt?.toISOString(),
      }));

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Write Tools ───────────────────────────────────────────

  server.tool(
    "update_project_status",
    "Change a project's status and log the update",
    {
      clientSlug: z.string().describe("Client slug (e.g. 'convergix')"),
      projectName: z.string().describe("Project name (fuzzy match)"),
      newStatus: z.string().describe("New status value"),
      updatedBy: z.string().describe("Person making the update"),
      notes: z.string().optional().describe("Additional context"),
    },
    async ({ clientSlug, projectName, newStatus, updatedBy, notes }) => {
      const db = getRunwayDb();
      const allClients = await db.select().from(clients);
      const client = allClients.find((c) => c.slug === clientSlug);
      if (!client) {
        return { content: [{ type: "text" as const, text: `Client '${clientSlug}' not found.` }] };
      }

      const clientProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.clientId, client.id));

      // Fuzzy match by lowercase includes
      const searchTerm = projectName.toLowerCase();
      const project = clientProjects.find((p) =>
        p.name.toLowerCase().includes(searchTerm)
      );

      if (!project) {
        const available = clientProjects.map((p) => p.name).join(", ");
        return {
          content: [{ type: "text" as const, text: `Project '${projectName}' not found for ${client.name}. Available: ${available}` }],
        };
      }

      const previousStatus = project.status;
      const idemKey = idempotencyKey("status-change", project.id, newStatus, updatedBy);

      // Check idempotency
      const existing = await db
        .select()
        .from(updates)
        .where(eq(updates.idempotencyKey, idemKey));

      if (existing.length > 0) {
        return { content: [{ type: "text" as const, text: "Update already applied (duplicate request)." }] };
      }

      // Update project
      await db
        .update(projects)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(projects.id, project.id));

      // Log update
      await db.insert(updates).values({
        id: newId(),
        idempotencyKey: idemKey,
        projectId: project.id,
        clientId: client.id,
        updatedBy,
        updateType: "status-change",
        previousValue: previousStatus,
        newValue: newStatus,
        summary: `${client.name} / ${project.name}: ${previousStatus} -> ${newStatus}${notes ? `. ${notes}` : ""}`,
      });

      return {
        content: [{
          type: "text" as const,
          text: `Updated ${client.name} / ${project.name}: ${previousStatus} -> ${newStatus}`,
        }],
      };
    }
  );

  server.tool(
    "add_project",
    "Create a new project under a client",
    {
      clientSlug: z.string().describe("Client slug"),
      name: z.string().describe("Project name"),
      status: z.string().optional().default("not-started"),
      category: z.string().optional().default("active"),
      owner: z.string().optional(),
      notes: z.string().optional(),
      updatedBy: z.string().describe("Person adding the project"),
    },
    async ({ clientSlug, name, status, category, owner, notes, updatedBy }) => {
      const db = getRunwayDb();
      const client = (await db.select().from(clients)).find((c) => c.slug === clientSlug);
      if (!client) {
        return { content: [{ type: "text" as const, text: `Client '${clientSlug}' not found.` }] };
      }

      const idemKey = idempotencyKey("add-project", client.id, name, updatedBy);
      const existing = await db.select().from(updates).where(eq(updates.idempotencyKey, idemKey));
      if (existing.length > 0) {
        return { content: [{ type: "text" as const, text: "Project already added (duplicate request)." }] };
      }

      const projectId = newId();
      await db.insert(projects).values({
        id: projectId,
        clientId: client.id,
        name,
        status,
        category,
        owner: owner ?? null,
        notes: notes ?? null,
        sortOrder: 999,
      });

      await db.insert(updates).values({
        id: newId(),
        idempotencyKey: idemKey,
        projectId,
        clientId: client.id,
        updatedBy,
        updateType: "new-item",
        newValue: name,
        summary: `New project added to ${client.name}: ${name}`,
      });

      return { content: [{ type: "text" as const, text: `Added project '${name}' to ${client.name}.` }] };
    }
  );

  server.tool(
    "add_update",
    "Log a free-form update for a client or project",
    {
      clientSlug: z.string().describe("Client slug"),
      projectName: z.string().optional().describe("Project name (fuzzy match)"),
      summary: z.string().describe("The update text"),
      updatedBy: z.string().describe("Person making the update"),
    },
    async ({ clientSlug, projectName, summary, updatedBy }) => {
      const db = getRunwayDb();
      const client = (await db.select().from(clients)).find((c) => c.slug === clientSlug);
      if (!client) {
        return { content: [{ type: "text" as const, text: `Client '${clientSlug}' not found.` }] };
      }

      let projectId: string | null = null;
      if (projectName) {
        const clientProjects = await db
          .select()
          .from(projects)
          .where(eq(projects.clientId, client.id));
        const match = clientProjects.find((p) =>
          p.name.toLowerCase().includes(projectName.toLowerCase())
        );
        projectId = match?.id ?? null;
      }

      const idemKey = idempotencyKey("note", client.id, summary, updatedBy, new Date().toISOString().slice(0, 16));

      const existing = await db.select().from(updates).where(eq(updates.idempotencyKey, idemKey));
      if (existing.length > 0) {
        return { content: [{ type: "text" as const, text: "Update already logged (duplicate request)." }] };
      }

      await db.insert(updates).values({
        id: newId(),
        idempotencyKey: idemKey,
        projectId,
        clientId: client.id,
        updatedBy,
        updateType: "note",
        summary: `${client.name}: ${summary}`,
      });

      return { content: [{ type: "text" as const, text: `Update logged for ${client.name}.` }] };
    }
  );

  // ── Context Tools ─────────────────────────────────────────

  server.tool("get_team_members", "List team members, roles, and what they track", {}, async () => {
    const db = getRunwayDb();
    const members = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.isActive, 1));

    const result = members.map((m) => ({
      name: m.name,
      title: m.title,
      channelPurpose: m.channelPurpose,
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  });

  server.tool(
    "get_client_contacts",
    "Get client-side contacts for a given client",
    { clientSlug: z.string().describe("Client slug") },
    async ({ clientSlug }) => {
      const db = getRunwayDb();
      const client = (await db.select().from(clients)).find((c) => c.slug === clientSlug);
      if (!client) {
        return { content: [{ type: "text" as const, text: `Client '${clientSlug}' not found.` }] };
      }

      let contacts: string[] = [];
      if (client.clientContacts) {
        try {
          contacts = JSON.parse(client.clientContacts);
        } catch {
          contacts = [client.clientContacts];
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ client: client.name, contacts }, null, 2),
        }],
      };
    }
  );

  return server;
}
