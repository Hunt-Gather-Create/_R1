/**
 * Runway prod reads for the diff engine. READ-ONLY — Phase 1a never writes.
 */
import { eq } from "drizzle-orm";
import { clients, projects, weekItems } from "../../src/lib/db/runway-schema";

export interface RunwayClientBundle {
  client: { id: string; slug: string; name: string };
  projects: {
    id: string;
    name: string;
    status: string | null;
    category: string | null;
    notes: string | null;
  }[];
  weekItems: {
    id: string;
    projectId: string | null;
    title: string;
    weekOf: string | null;
    startDate: string | null;
    endDate: string | null;
    status: string | null;
    category: string | null;
    notes: string | null;
  }[];
}

// drizzle db instance type from createRunwayDb — kept loose; scripts are the
// only consumer and the queries below are the entire surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readClientBundle(db: any, slug: string): Promise<RunwayClientBundle> {
  const clientRows = await db
    .select({ id: clients.id, slug: clients.slug, name: clients.name })
    .from(clients)
    .where(eq(clients.slug, slug));
  if (clientRows.length === 0) {
    throw new Error(`Client slug "${slug}" not found in Runway prod`);
  }
  const client = clientRows[0];

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      category: projects.category,
      notes: projects.notes,
    })
    .from(projects)
    .where(eq(projects.clientId, client.id));

  const weekItemRows = await db
    .select({
      id: weekItems.id,
      projectId: weekItems.projectId,
      title: weekItems.title,
      weekOf: weekItems.weekOf,
      startDate: weekItems.startDate,
      endDate: weekItems.endDate,
      status: weekItems.status,
      category: weekItems.category,
      notes: weekItems.notes,
    })
    .from(weekItems)
    .where(eq(weekItems.clientId, client.id));

  return { client, projects: projectRows, weekItems: weekItemRows };
}
