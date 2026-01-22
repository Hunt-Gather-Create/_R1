import type { boards, columns, cards } from "./db/schema";

export type Board = typeof boards.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type Card = typeof cards.$inferSelect;

export type ColumnWithCards = Column & {
  cards: Card[];
};

export type BoardWithColumnsAndCards = Board & {
  columns: ColumnWithCards[];
};
