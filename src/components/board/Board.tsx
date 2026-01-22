"use client";

import { useState, useOptimistic, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Column } from "./Column";
import { Card as CardComponent } from "./Card";
import { CardModal } from "./CardModal";
import { createCard, updateCard, deleteCard, moveCard } from "@/lib/actions/cards";
import type { BoardWithColumnsAndCards, Card, ColumnWithCards } from "@/lib/types";

interface BoardProps {
  initialBoard: BoardWithColumnsAndCards;
}

type OptimisticAction =
  | { type: "addCard"; columnId: string; card: Card }
  | { type: "updateCard"; cardId: string; data: { title?: string; description?: string | null } }
  | { type: "deleteCard"; cardId: string }
  | { type: "moveCard"; cardId: string; targetColumnId: string; targetPosition: number };

function boardReducer(
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

export function Board({ initialBoard }: BoardProps) {
  const [optimisticBoard, addOptimistic] = useOptimistic(initialBoard, boardReducer);
  const [isPending, startTransition] = useTransition();
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const findColumn = (cardId: string): ColumnWithCards | undefined => {
    return optimisticBoard.columns.find((col) =>
      col.cards.some((card) => card.id === cardId)
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const card = optimisticBoard.columns
      .flatMap((col) => col.cards)
      .find((c) => c.id === active.id);
    setActiveCard(card ?? null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeColumn = findColumn(activeId);

    let overColumnId: string;
    if (overId.startsWith("column-")) {
      overColumnId = overId.replace("column-", "");
    } else {
      const overColumn = findColumn(overId);
      if (!overColumn) return;
      overColumnId = overColumn.id;
    }

    if (!activeColumn || activeColumn.id === overColumnId) return;

    const overColumn = optimisticBoard.columns.find((c) => c.id === overColumnId);
    if (!overColumn) return;

    const overIndex = overId.startsWith("column-")
      ? overColumn.cards.length
      : overColumn.cards.findIndex((c) => c.id === overId);

    startTransition(() => {
      addOptimistic({
        type: "moveCard",
        cardId: activeId,
        targetColumnId: overColumnId,
        targetPosition: overIndex >= 0 ? overIndex : overColumn.cards.length,
      });
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeColumn = findColumn(activeId);
    if (!activeColumn) return;

    let targetColumnId: string;
    let targetPosition: number;

    if (overId.startsWith("column-")) {
      targetColumnId = overId.replace("column-", "");
      const targetColumn = optimisticBoard.columns.find((c) => c.id === targetColumnId);
      targetPosition = targetColumn?.cards.length ?? 0;
    } else {
      const overColumn = findColumn(overId);
      if (!overColumn) return;
      targetColumnId = overColumn.id;
      const overIndex = overColumn.cards.findIndex((c) => c.id === overId);

      if (activeColumn.id === targetColumnId) {
        const activeIndex = activeColumn.cards.findIndex((c) => c.id === activeId);
        if (activeIndex === overIndex) return;

        const reorderedCards = arrayMove(activeColumn.cards, activeIndex, overIndex);
        targetPosition = reorderedCards.findIndex((c) => c.id === activeId);
      } else {
        targetPosition = overIndex;
      }
    }

    startTransition(async () => {
      await moveCard(activeId, targetColumnId, targetPosition);
    });
  };

  const handleAddCard = (columnId: string, title: string) => {
    const tempCard: Card = {
      id: crypto.randomUUID(),
      columnId,
      title,
      description: null,
      position: optimisticBoard.columns.find((c) => c.id === columnId)?.cards.length ?? 0,
      createdAt: new Date(),
    };

    startTransition(async () => {
      addOptimistic({ type: "addCard", columnId, card: tempCard });
      await createCard(columnId, title);
    });
  };

  const handleUpdateCard = (
    cardId: string,
    data: { title: string; description: string | null }
  ) => {
    startTransition(async () => {
      addOptimistic({ type: "updateCard", cardId, data });
      await updateCard(cardId, data);
    });
  };

  const handleDeleteCard = (cardId: string) => {
    startTransition(async () => {
      addOptimistic({ type: "deleteCard", cardId });
      await deleteCard(cardId);
    });
  };

  const handleCardClick = (card: Card) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {optimisticBoard.columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              onCardClick={handleCardClick}
              onAddCard={handleAddCard}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard && (
            <div className="rotate-3">
              <CardComponent card={activeCard} onClick={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <CardModal
        card={selectedCard}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onUpdate={handleUpdateCard}
        onDelete={handleDeleteCard}
      />
    </>
  );
}
