"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { epics, issues } from "../db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { STATUS } from "../design-tokens";
import type { Epic, CreateEpicInput, EpicStatus, SubtaskCount } from "../types";
import { requireWorkspaceAccess } from "./workspace";
import { getWorkspaceSlug } from "./helpers";

export async function createEpic(
  workspaceId: string,
  input: CreateEpicInput
): Promise<Epic> {
  await requireWorkspaceAccess(workspaceId, "member");

  const now = new Date();
  const newEpic: Epic = {
    id: crypto.randomUUID(),
    workspaceId,
    title: input.title,
    description: input.description ?? null,
    status: "active",
    dueDate: input.dueDate ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(epics).values(newEpic);

  const slug = await getWorkspaceSlug(workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  return newEpic;
}

export async function updateEpic(
  epicId: string,
  data: { title?: string; description?: string; status?: EpicStatus; dueDate?: Date | null }
): Promise<Epic> {
  const [existing] = await db
    .select()
    .from(epics)
    .where(eq(epics.id, epicId))
    .limit(1);

  if (!existing) throw new Error("Epic not found");

  await requireWorkspaceAccess(existing.workspaceId, "member");

  const updated = {
    ...existing,
    ...data,
    updatedAt: new Date(),
  };

  await db.update(epics).set(updated).where(eq(epics.id, epicId));

  const slug = await getWorkspaceSlug(existing.workspaceId);
  revalidatePath(slug ? `/w/${slug}` : "/");

  return updated;
}

export async function getWorkspaceEpics(
  workspaceId: string
): Promise<Epic[]> {
  await requireWorkspaceAccess(workspaceId);

  return db
    .select()
    .from(epics)
    .where(eq(epics.workspaceId, workspaceId))
    .orderBy(desc(epics.createdAt));
}

/**
 * Get aggregated subtask progress for all issues in an epic.
 * Returns { total, completed } across all subtasks of all issues.
 */
export async function getEpicProgress(
  issueIds: string[]
): Promise<SubtaskCount> {
  if (issueIds.length === 0) return { total: 0, completed: 0 };

  const subtasks = await db
    .select({ status: issues.status })
    .from(issues)
    .where(inArray(issues.parentIssueId, issueIds));

  const total = subtasks.length;
  const completed = subtasks.filter(
    (s) => s.status === STATUS.DONE || s.status === STATUS.CANCELED
  ).length;

  return { total, completed };
}
