"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { cycles } from "../db/schema";
import { eq, asc } from "drizzle-orm";
import type { Cycle } from "../types";
import { requireWorkspaceAccess } from "./workspace";

export async function createCycle(
  workspaceId: string,
  data: {
    name: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<Cycle> {
  await requireWorkspaceAccess(workspaceId, "member");

  const cycle = {
    id: crypto.randomUUID(),
    workspaceId,
    name: data.name,
    description: data.description ?? null,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    status: "upcoming",
    createdAt: new Date(),
  };

  await db.insert(cycles).values(cycle);
  revalidatePath("/");

  return cycle;
}

export async function updateCycle(
  cycleId: string,
  data: {
    name?: string;
    description?: string;
    startDate?: Date | null;
    endDate?: Date | null;
    status?: "upcoming" | "active" | "completed";
  }
): Promise<void> {
  const cycle = await db
    .select()
    .from(cycles)
    .where(eq(cycles.id, cycleId))
    .get();

  if (!cycle) {
    throw new Error("Cycle not found");
  }

  await requireWorkspaceAccess(cycle.workspaceId, "member");

  await db.update(cycles).set(data).where(eq(cycles.id, cycleId));
  revalidatePath("/");
}

export async function deleteCycle(cycleId: string): Promise<void> {
  const cycle = await db
    .select()
    .from(cycles)
    .where(eq(cycles.id, cycleId))
    .get();

  if (!cycle) {
    throw new Error("Cycle not found");
  }

  await requireWorkspaceAccess(cycle.workspaceId, "member");

  await db.delete(cycles).where(eq(cycles.id, cycleId));
  revalidatePath("/");
}

export async function getWorkspaceCycles(
  workspaceId: string
): Promise<Cycle[]> {
  await requireWorkspaceAccess(workspaceId);

  return db
    .select()
    .from(cycles)
    .where(eq(cycles.workspaceId, workspaceId))
    .orderBy(asc(cycles.startDate));
}

export async function activateCycle(cycleId: string): Promise<void> {
  const cycle = await db
    .select()
    .from(cycles)
    .where(eq(cycles.id, cycleId))
    .get();

  if (!cycle) {
    throw new Error("Cycle not found");
  }

  await requireWorkspaceAccess(cycle.workspaceId, "member");

  await db
    .update(cycles)
    .set({ status: "active" })
    .where(eq(cycles.id, cycleId));
  revalidatePath("/");
}

export async function completeCycle(cycleId: string): Promise<void> {
  const cycle = await db
    .select()
    .from(cycles)
    .where(eq(cycles.id, cycleId))
    .get();

  if (!cycle) {
    throw new Error("Cycle not found");
  }

  await requireWorkspaceAccess(cycle.workspaceId, "member");

  await db
    .update(cycles)
    .set({ status: "completed" })
    .where(eq(cycles.id, cycleId));
  revalidatePath("/");
}
