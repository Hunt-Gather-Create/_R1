"use server";

import { db } from "../db";
import { boards, columns, cards, issues, labels, issueLabels, cycles } from "../db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import type {
  BoardWithColumnsAndCards,
  BoardWithColumnsAndIssues,
  Label,
} from "../types";

const DEFAULT_BOARD_ID = "default-board";
const DEFAULT_COLUMNS = ["Backlog", "Todo", "In Progress", "Done"];

// Default labels to seed
const DEFAULT_LABELS: Array<{ name: string; color: string }> = [
  { name: "Bug", color: "#ef4444" },
  { name: "Feature", color: "#3b82f6" },
  { name: "Improvement", color: "#22c55e" },
  { name: "Documentation", color: "#a855f7" },
];

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
      identifier: "AUTO",
      issueCounter: 0,
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

    // Seed default labels
    for (const label of DEFAULT_LABELS) {
      await db.insert(labels).values({
        id: crypto.randomUUID(),
        boardId: DEFAULT_BOARD_ID,
        name: label.name,
        color: label.color,
        createdAt: new Date(),
      });
    }
  }

  return getBoardWithColumnsAndCards(DEFAULT_BOARD_ID);
}

// Legacy function for backward compatibility with existing Card-based components
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

// New function for Issue-based components
export async function getBoardWithColumnsAndIssues(
  boardId: string
): Promise<BoardWithColumnsAndIssues> {
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

  // Get all labels for this board
  const boardLabels = await db
    .select()
    .from(labels)
    .where(eq(labels.boardId, boardId))
    .orderBy(asc(labels.name));

  // Get all cycles for this board
  const boardCycles = await db
    .select()
    .from(cycles)
    .where(eq(cycles.boardId, boardId))
    .orderBy(asc(cycles.startDate));

  const columnsWithIssues = await Promise.all(
    boardColumns.map(async (column) => {
      const columnIssues = await db
        .select()
        .from(issues)
        .where(eq(issues.columnId, column.id))
        .orderBy(asc(issues.position));

      // Get labels for each issue
      const issuesWithLabels = await Promise.all(
        columnIssues.map(async (issue) => {
          const issueLabelRows = await db
            .select({ label: labels })
            .from(issueLabels)
            .innerJoin(labels, eq(issueLabels.labelId, labels.id))
            .where(eq(issueLabels.issueId, issue.id));

          return {
            ...issue,
            labels: issueLabelRows.map((row) => row.label),
          };
        })
      );

      return {
        ...column,
        issues: issuesWithLabels,
      };
    })
  );

  return {
    ...board,
    columns: columnsWithIssues,
    labels: boardLabels,
    cycles: boardCycles,
  };
}

// Get or create default board with issues (new version)
export async function getOrCreateDefaultBoardWithIssues(): Promise<BoardWithColumnsAndIssues> {
  const existingBoard = await db
    .select()
    .from(boards)
    .where(eq(boards.id, DEFAULT_BOARD_ID))
    .get();

  if (!existingBoard) {
    await db.insert(boards).values({
      id: DEFAULT_BOARD_ID,
      name: "My Workspace",
      identifier: "AUTO",
      issueCounter: 0,
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

    // Seed default labels
    for (const label of DEFAULT_LABELS) {
      await db.insert(labels).values({
        id: crypto.randomUUID(),
        boardId: DEFAULT_BOARD_ID,
        name: label.name,
        color: label.color,
        createdAt: new Date(),
      });
    }
  }

  return getBoardWithColumnsAndIssues(DEFAULT_BOARD_ID);
}

// Label management
export async function createLabel(
  boardId: string,
  name: string,
  color: string
): Promise<Label> {
  const label: Label = {
    id: crypto.randomUUID(),
    boardId,
    name,
    color,
    createdAt: new Date(),
  };

  await db.insert(labels).values(label);
  return label;
}

export async function updateLabel(
  labelId: string,
  data: { name?: string; color?: string }
): Promise<void> {
  await db.update(labels).set(data).where(eq(labels.id, labelId));
}

export async function deleteLabel(labelId: string): Promise<void> {
  await db.delete(labels).where(eq(labels.id, labelId));
}

export async function getBoardLabels(boardId: string): Promise<Label[]> {
  return db
    .select()
    .from(labels)
    .where(eq(labels.boardId, boardId))
    .orderBy(asc(labels.name));
}
