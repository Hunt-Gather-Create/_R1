/**
 * Hydrate HDL + Hopdoddy — post-overnight QA pull
 *
 * Pulls fresh prod state for:
 *   - High Desert Law: Website Build L1 + all WIs
 *   - Hopdoddy: all L1s, all L2s, all WIs (retainer + project structure)
 *
 * Writes JSON to docs/tmp/hydrate-{hdl,hopdoddy}-2026-05-28-post.json
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as resolvePath, dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { MigrationContext } from "../runway-migrate";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";

export const description = "Hydrate HDL + Hopdoddy state for post-apply QA";

export async function up(ctx: MigrationContext): Promise<void> {
  for (const slug of ["hdl", "hopdoddy"]) {
    const [client] = await ctx.db.select().from(clients).where(eq(clients.slug, slug));
    if (!client) throw new Error(`No client found for slug=${slug}`);
    const allProjects = await ctx.db.select().from(projects).where(eq(projects.clientId, client.id));
    const allWis = await ctx.db.select().from(weekItems).where(eq(weekItems.clientId, client.id));

    const snapshot = {
      pulledAt: new Date().toISOString(),
      client,
      projects: allProjects,
      weekItems: allWis,
    };
    const outPath = resolvePath(
      process.cwd(),
      `docs/tmp/hydrate-${slug}-2026-05-28-post.json`,
    );
    if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    ctx.log(
      `Wrote ${slug} snapshot: ${allProjects.length} projects, ${allWis.length} weekItems → ${outPath}`,
    );
  }
}
