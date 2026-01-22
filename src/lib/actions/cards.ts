"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { cards } from "../db/schema";
import { eq, and, gt, gte, lt, sql } from "drizzle-orm";
import type { Card } from "../types";

export async function createCard(
  columnId: string,
  title: string
): Promise<Card> {
  const maxPosition = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(position), -1)` })
    .from(cards)
    .where(eq(cards.columnId, columnId))
    .get();

  const newCard = {
    id: crypto.randomUUID(),
    columnId,
    title,
    description: null,
    position: (maxPosition?.maxPos ?? -1) + 1,
    createdAt: new Date(),
  };

  await db.insert(cards).values(newCard);
  revalidatePath("/");

  return newCard;
}

export async function updateCard(
  cardId: string,
  data: { title?: string; description?: string | null }
): Promise<void> {
  await db.update(cards).set(data).where(eq(cards.id, cardId));
  revalidatePath("/");
}

export async function deleteCard(cardId: string): Promise<void> {
  const card = await db.select().from(cards).where(eq(cards.id, cardId)).get();

  if (!card) return;

  await db.delete(cards).where(eq(cards.id, cardId));

  await db
    .update(cards)
    .set({ position: sql`position - 1` })
    .where(
      and(eq(cards.columnId, card.columnId), gt(cards.position, card.position))
    );

  revalidatePath("/");
}

export async function moveCard(
  cardId: string,
  targetColumnId: string,
  targetPosition: number
): Promise<void> {
  const card = await db.select().from(cards).where(eq(cards.id, cardId)).get();

  if (!card) return;

  const sourceColumnId = card.columnId;
  const sourcePosition = card.position;

  if (sourceColumnId === targetColumnId) {
    if (sourcePosition === targetPosition) return;

    if (sourcePosition < targetPosition) {
      await db
        .update(cards)
        .set({ position: sql`position - 1` })
        .where(
          and(
            eq(cards.columnId, sourceColumnId),
            gt(cards.position, sourcePosition),
            lt(cards.position, targetPosition + 1)
          )
        );
    } else {
      await db
        .update(cards)
        .set({ position: sql`position + 1` })
        .where(
          and(
            eq(cards.columnId, sourceColumnId),
            gte(cards.position, targetPosition),
            lt(cards.position, sourcePosition)
          )
        );
    }

    await db
      .update(cards)
      .set({ position: targetPosition })
      .where(eq(cards.id, cardId));
  } else {
    await db
      .update(cards)
      .set({ position: sql`position - 1` })
      .where(
        and(
          eq(cards.columnId, sourceColumnId),
          gt(cards.position, sourcePosition)
        )
      );

    await db
      .update(cards)
      .set({ position: sql`position + 1` })
      .where(
        and(
          eq(cards.columnId, targetColumnId),
          gte(cards.position, targetPosition)
        )
      );

    await db
      .update(cards)
      .set({ columnId: targetColumnId, position: targetPosition })
      .where(eq(cards.id, cardId));
  }

  revalidatePath("/");
}
