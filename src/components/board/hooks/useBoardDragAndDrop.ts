"use client";

import { useState, useCallback } from "react";
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { Card, BoardWithColumnsAndCards, ColumnWithCards } from "@/lib/types";

interface UseBoardDragAndDropOptions {
  board: BoardWithColumnsAndCards;
  initialBoard: BoardWithColumnsAndCards;
  findColumn: (cardId: string) => ColumnWithCards | undefined;
  addOptimistic: (action: {
    type: "moveCard";
    cardId: string;
    targetColumnId: string;
    targetPosition: number;
  }) => void;
  startTransition: (callback: () => void) => void;
  moveCardToColumn: (cardId: string, targetColumnId: string, targetPosition: number) => void;
}

export function useBoardDragAndDrop({
  board,
  initialBoard,
  findColumn,
  addOptimistic,
  startTransition,
  moveCardToColumn,
}: UseBoardDragAndDropOptions) {
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [originalColumnId, setOriginalColumnId] = useState<string | null>(null);
  const [isOverDropzone, setIsOverDropzone] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const column = findColumn(active.id as string);
      const card = column?.cards.find((c) => c.id === active.id);
      setActiveCard(card ?? null);
      setOriginalColumnId(column?.id ?? null);
    },
    [findColumn]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;

      if (!over) {
        setIsOverDropzone(false);
        return;
      }

      setIsOverDropzone(true);
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

      const overColumn = board.columns.find((c) => c.id === overColumnId);
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
    },
    [board.columns, findColumn, addOptimistic, startTransition]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const draggedFromColumnId = originalColumnId;
      setActiveCard(null);
      setOriginalColumnId(null);
      setIsOverDropzone(false);

      if (!over || !draggedFromColumnId) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      let targetColumnId: string;
      let targetPosition: number;

      if (overId.startsWith("column-")) {
        targetColumnId = overId.replace("column-", "");
        const targetColumn = board.columns.find((c) => c.id === targetColumnId);
        targetPosition = targetColumn?.cards.length ?? 0;
      } else {
        const overColumn = findColumn(overId);
        if (!overColumn) return;
        targetColumnId = overColumn.id;
        const overIndex = overColumn.cards.findIndex((c) => c.id === overId);

        if (draggedFromColumnId === targetColumnId) {
          const originalColumn = initialBoard.columns.find(
            (c) => c.id === draggedFromColumnId
          );
          if (!originalColumn) return;
          const activeIndex = originalColumn.cards.findIndex((c) => c.id === activeId);
          if (activeIndex === overIndex) return;

          const reorderedCards = arrayMove(originalColumn.cards, activeIndex, overIndex);
          targetPosition = reorderedCards.findIndex((c) => c.id === activeId);
        } else {
          targetPosition = overIndex;
        }
      }

      moveCardToColumn(activeId, targetColumnId, targetPosition);
    },
    [board.columns, initialBoard.columns, originalColumnId, findColumn, moveCardToColumn]
  );

  return {
    sensors,
    activeCard,
    isOverDropzone,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
}
