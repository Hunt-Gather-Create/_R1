"use server";

import { db } from "../db";
import { boards, columns, cards } from "../db/schema";
import { eq, asc } from "drizzle-orm";
import type { BoardWithColumnsAndCards } from "../types";

const DEFAULT_BOARD_ID = "default-board";
const DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"];

export async function getOrCreateDefaultBoard(): Promise<BoardWithColumnsAndCards> {
  const existingBoard = await db
    .select()
    .from(boards)
    .where(eq(boards.id, DEFAULT_BOARD_ID))
    .get();

  if (!existingBoard) {
    await db.insert(boards).values({
      id: DEFAULT_BOARD_ID,
      name: "My Board",
      createdAt: new Date(),
    });

    for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
      await db.insert(columns).values({
        id: crypto.randomUUID(),
        boardId: DEFAULT_BOARD_ID,
        name: DEFAULT_COLUMNS[i],
        position: i,
      });
    }
  }

  return getBoardWithColumnsAndCards(DEFAULT_BOARD_ID);
}

export async function getBoardWithColumnsAndCards(
  boardId: string
): Promise<BoardWithColumnsAndCards> {
  const board = await db
    .select()
    .from(boards)
    .where(eq(boards.id, boardId))
    .get();

  if (!board) {
    throw new Error(`Board not found: ${boardId}`);
  }

  const boardColumns = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position));

  const columnsWithCards = await Promise.all(
    boardColumns.map(async (column) => {
      const columnCards = await db
        .select()
        .from(cards)
        .where(eq(cards.columnId, column.id))
        .orderBy(asc(cards.position));

      return {
        ...column,
        cards: columnCards,
      };
    })
  );

  return {
    ...board,
    columns: columnsWithCards,
  };
}
