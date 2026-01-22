"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { cycles } from "../db/schema";
import { eq, and, asc } from "drizzle-orm";
import type { Cycle } from "../types";

export async function createCycle(
  boardId: string,
  data: {
    name: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<Cycle> {
  const cycle: Cycle = {
    id: crypto.randomUUID(),
    boardId,
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
  await db.update(cycles).set(data).where(eq(cycles.id, cycleId));
  revalidatePath("/");
}

export async function deleteCycle(cycleId: string): Promise<void> {
  await db.delete(cycles).where(eq(cycles.id, cycleId));
  revalidatePath("/");
}

export async function getBoardCycles(boardId: string): Promise<Cycle[]> {
  return db
    .select()
    .from(cycles)
    .where(eq(cycles.boardId, boardId))
    .orderBy(asc(cycles.startDate));
}

export async function activateCycle(cycleId: string): Promise<void> {
  await db
    .update(cycles)
    .set({ status: "active" })
    .where(eq(cycles.id, cycleId));
  revalidatePath("/");
}

export async function completeCycle(cycleId: string): Promise<void> {
  await db
    .update(cycles)
    .set({ status: "completed" })
    .where(eq(cycles.id, cycleId));
  revalidatePath("/");
}
