"use client";

import {
  createContext,
  useContext,
  useOptimistic,
  useTransition,
  type ReactNode,
} from "react";
import { createCard, updateCard, deleteCard, moveCard } from "@/lib/actions/cards";
import type { BoardWithColumnsAndCards, Card, ColumnWithCards } from "@/lib/types";

type OptimisticAction =
  | { type: "addCard"; columnId: string; card: Card }
  | { type: "updateCard"; cardId: string; data: { title?: string; description?: string | null } }
  | { type: "deleteCard"; cardId: string }
  | { type: "moveCard"; cardId: string; targetColumnId: string; targetPosition: number };

export function boardReducer(
  state: BoardWithColumnsAndCards,
  action: OptimisticAction
): BoardWithColumnsAndCards {
  switch (action.type) {
    case "addCard": {
      return {
        ...state,
        columns: state.columns.map((col) =>
          col.id === action.columnId
            ? { ...col, cards: [...col.cards, action.card] }
            : col
        ),
      };
    }
    case "updateCard": {
      return {
        ...state,
        columns: state.columns.map((col) => ({
          ...col,
          cards: col.cards.map((card) =>
            card.id === action.cardId ? { ...card, ...action.data } : card
          ),
        })),
      };
    }
    case "deleteCard": {
      return {
        ...state,
        columns: state.columns.map((col) => ({
          ...col,
          cards: col.cards.filter((card) => card.id !== action.cardId),
        })),
      };
    }
    case "moveCard": {
      const { cardId, targetColumnId, targetPosition } = action;
      let movedCard: Card | null = null;

      const columnsWithoutCard = state.columns.map((col) => {
        const cardIndex = col.cards.findIndex((c) => c.id === cardId);
        if (cardIndex !== -1) {
          movedCard = col.cards[cardIndex];
          return {
            ...col,
            cards: col.cards.filter((c) => c.id !== cardId),
          };
        }
        return col;
      });

      if (!movedCard) return state;

      return {
        ...state,
        columns: columnsWithoutCard.map((col) => {
          if (col.id === targetColumnId) {
            const newCards = [...col.cards];
            newCards.splice(targetPosition, 0, {
              ...movedCard!,
              columnId: targetColumnId,
              position: targetPosition,
            });
            return {
              ...col,
              cards: newCards.map((c, i) => ({ ...c, position: i })),
            };
          }
          return col;
        }),
      };
    }
    default:
      return state;
  }
}

interface BoardContextValue {
  board: BoardWithColumnsAndCards;
  initialBoard: BoardWithColumnsAndCards;
  addOptimistic: (action: OptimisticAction) => void;
  startTransition: (callback: () => void) => void;
  findColumn: (cardId: string) => ColumnWithCards | undefined;
  addCard: (columnId: string, title: string) => void;
  updateCardData: (cardId: string, data: { title: string; description: string | null }) => void;
  removeCard: (cardId: string) => void;
  moveCardToColumn: (cardId: string, targetColumnId: string, targetPosition: number) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

interface BoardProviderProps {
  initialBoard: BoardWithColumnsAndCards;
  children: ReactNode;
}

export function BoardProvider({ initialBoard, children }: BoardProviderProps) {
  const [board, addOptimistic] = useOptimistic(initialBoard, boardReducer);
  const [, startTransition] = useTransition();

  const findColumn = (cardId: string): ColumnWithCards | undefined => {
    return board.columns.find((col) => col.cards.some((card) => card.id === cardId));
  };

  const addCard = (columnId: string, title: string) => {
    const tempCard: Card = {
      id: crypto.randomUUID(),
      columnId,
      title,
      description: null,
      position: board.columns.find((c) => c.id === columnId)?.cards.length ?? 0,
      createdAt: new Date(),
    };

    startTransition(async () => {
      addOptimistic({ type: "addCard", columnId, card: tempCard });
      await createCard(columnId, title);
    });
  };

  const updateCardData = (
    cardId: string,
    data: { title: string; description: string | null }
  ) => {
    startTransition(async () => {
      addOptimistic({ type: "updateCard", cardId, data });
      await updateCard(cardId, data);
    });
  };

  const removeCard = (cardId: string) => {
    startTransition(async () => {
      addOptimistic({ type: "deleteCard", cardId });
      await deleteCard(cardId);
    });
  };

  const moveCardToColumn = (
    cardId: string,
    targetColumnId: string,
    targetPosition: number
  ) => {
    startTransition(async () => {
      await moveCard(cardId, targetColumnId, targetPosition);
    });
  };

  return (
    <BoardContext.Provider
      value={{
        board,
        initialBoard,
        addOptimistic,
        startTransition,
        findColumn,
        addCard,
        updateCardData,
        removeCard,
        moveCardToColumn,
      }}
    >
      {children}
    </BoardContext.Provider>
  );
}

export function useBoardContext() {
  const context = useContext(BoardContext);
  if (!context) {
    throw new Error("useBoardContext must be used within a BoardProvider");
  }
  return context;
}
