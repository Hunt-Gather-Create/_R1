/**
 * Server-side soul utilities that require database access.
 * For client-safe utilities, import from ./soul-formatters instead.
 */
import type { WorkspaceSoul } from "./types";
import { db } from "./db";
import { workspaces } from "./db/schema";
import { eq } from "drizzle-orm";

// Re-export client-safe functions for backwards compatibility
export {
  buildSoulSystemPrompt,
  exportSoulAsMarkdown,
  createDefaultSoul,
} from "./soul-formatters";

/**
 * Load the workspace soul/persona configuration from the database.
 * Returns null if the workspace doesn't exist or has no soul configured.
 *
 * NOTE: This is a server-only function. Do not import this file in client components.
 * Use ./soul-formatters for client-safe utilities.
 */
export async function getWorkspaceSoul(workspaceId: string | undefined): Promise<WorkspaceSoul | null> {
  if (!workspaceId) return null;

  const workspace = await db
    .select({ soul: workspaces.soul })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();

  if (!workspace?.soul) return null;

  try {
    return JSON.parse(workspace.soul) as WorkspaceSoul;
  } catch {
    return null;
  }
}
