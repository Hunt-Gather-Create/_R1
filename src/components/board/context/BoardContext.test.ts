import { describe, it, expect } from "vitest";
import { boardReducer } from "./BoardContext";
import type { BoardWithColumnsAndCards, Card } from "@/lib/types";

const createMockBoard = (): BoardWithColumnsAndCards => ({
  id: "board-1",
  name: "Test Board",
  identifier: "TEST",
  issueCounter: 0,
  createdAt: new Date("2024-01-01"),
  columns: [
    {
      id: "col-1",
      boardId: "board-1",
      name: "To Do",
      position: 0,
      cards: [
        {
          id: "card-1",
          columnId: "col-1",
          title: "Card 1",
          description: "Description 1",
          position: 0,
          createdAt: new Date("2024-01-01"),
        },
        {
          id: "card-2",
          columnId: "col-1",
          title: "Card 2",
          description: null,
          position: 1,
          createdAt: new Date("2024-01-01"),
        },
      ],
    },
    {
      id: "col-2",
      boardId: "board-1",
      name: "In Progress",
      position: 1,
      cards: [
        {
          id: "card-3",
          columnId: "col-2",
          title: "Card 3",
          description: null,
          position: 0,
          createdAt: new Date("2024-01-01"),
        },
      ],
    },
    {
      id: "col-3",
      boardId: "board-1",
      name: "Done",
      position: 2,
      cards: [],
    },
  ],
});

describe("boardReducer", () => {
  describe("addCard", () => {
    it("should add a card to the specified column", () => {
      const board = createMockBoard();
      const newCard: Card = {
        id: "card-new",
        columnId: "col-1",
        title: "New Card",
        description: null,
        position: 2,
        createdAt: new Date("2024-01-01"),
      };

      const result = boardReducer(board, {
        type: "addCard",
        columnId: "col-1",
        card: newCard,
      });

      expect(result.columns[0].cards).toHaveLength(3);
      expect(result.columns[0].cards[2]).toEqual(newCard);
    });

    it("should add a card to an empty column", () => {
      const board = createMockBoard();
      const newCard: Card = {
        id: "card-new",
        columnId: "col-3",
        title: "New Card",
        description: null,
        position: 0,
        createdAt: new Date("2024-01-01"),
      };

      const result = boardReducer(board, {
        type: "addCard",
        columnId: "col-3",
        card: newCard,
      });

      expect(result.columns[2].cards).toHaveLength(1);
      expect(result.columns[2].cards[0]).toEqual(newCard);
    });

    it("should not modify other columns", () => {
      const board = createMockBoard();
      const newCard: Card = {
        id: "card-new",
        columnId: "col-1",
        title: "New Card",
        description: null,
        position: 2,
        createdAt: new Date("2024-01-01"),
      };

      const result = boardReducer(board, {
        type: "addCard",
        columnId: "col-1",
        card: newCard,
      });

      expect(result.columns[1].cards).toHaveLength(1);
      expect(result.columns[2].cards).toHaveLength(0);
    });
  });

  describe("updateCard", () => {
    it("should update card title", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "updateCard",
        cardId: "card-1",
        data: { title: "Updated Title" },
      });

      expect(result.columns[0].cards[0].title).toBe("Updated Title");
      expect(result.columns[0].cards[0].description).toBe("Description 1");
    });

    it("should update card description", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "updateCard",
        cardId: "card-1",
        data: { description: "New Description" },
      });

      expect(result.columns[0].cards[0].description).toBe("New Description");
      expect(result.columns[0].cards[0].title).toBe("Card 1");
    });

    it("should update both title and description", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "updateCard",
        cardId: "card-1",
        data: { title: "New Title", description: "New Description" },
      });

      expect(result.columns[0].cards[0].title).toBe("New Title");
      expect(result.columns[0].cards[0].description).toBe("New Description");
    });

    it("should not modify other cards", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "updateCard",
        cardId: "card-1",
        data: { title: "Updated Title" },
      });

      expect(result.columns[0].cards[1].title).toBe("Card 2");
      expect(result.columns[1].cards[0].title).toBe("Card 3");
    });
  });

  describe("deleteCard", () => {
    it("should remove a card from its column", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "deleteCard",
        cardId: "card-1",
      });

      expect(result.columns[0].cards).toHaveLength(1);
      expect(result.columns[0].cards[0].id).toBe("card-2");
    });

    it("should remove the only card from a column", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "deleteCard",
        cardId: "card-3",
      });

      expect(result.columns[1].cards).toHaveLength(0);
    });

    it("should not modify other columns", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "deleteCard",
        cardId: "card-1",
      });

      expect(result.columns[1].cards).toHaveLength(1);
    });
  });

  describe("moveCard", () => {
    it("should move a card to a different column", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "moveCard",
        cardId: "card-1",
        targetColumnId: "col-2",
        targetPosition: 0,
      });

      expect(result.columns[0].cards).toHaveLength(1);
      expect(result.columns[1].cards).toHaveLength(2);
      expect(result.columns[1].cards[0].id).toBe("card-1");
      expect(result.columns[1].cards[0].columnId).toBe("col-2");
    });

    it("should move a card to an empty column", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "moveCard",
        cardId: "card-1",
        targetColumnId: "col-3",
        targetPosition: 0,
      });

      expect(result.columns[0].cards).toHaveLength(1);
      expect(result.columns[2].cards).toHaveLength(1);
      expect(result.columns[2].cards[0].id).toBe("card-1");
    });

    it("should update positions after move", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "moveCard",
        cardId: "card-1",
        targetColumnId: "col-2",
        targetPosition: 1,
      });

      expect(result.columns[1].cards[0].position).toBe(0);
      expect(result.columns[1].cards[1].position).toBe(1);
    });

    it("should handle moving to a specific position", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "moveCard",
        cardId: "card-1",
        targetColumnId: "col-2",
        targetPosition: 1,
      });

      expect(result.columns[1].cards[0].id).toBe("card-3");
      expect(result.columns[1].cards[1].id).toBe("card-1");
    });

    it("should return unchanged state if card not found", () => {
      const board = createMockBoard();

      const result = boardReducer(board, {
        type: "moveCard",
        cardId: "non-existent",
        targetColumnId: "col-2",
        targetPosition: 0,
      });

      expect(result).toEqual(board);
    });
  });
});
