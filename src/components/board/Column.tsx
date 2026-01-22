"use client";

import { useState, useEffect } from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { Card } from "./Card";
import { AddCardForm } from "./AddCardForm";
import type { ColumnWithCards, Card as CardType } from "@/lib/types";

interface ColumnProps {
  column: ColumnWithCards;
  onCardClick: (card: CardType) => void;
  onAddCard: (columnId: string, title: string) => void;
}

export function Column({ column, onCardClick, onAddCard }: ColumnProps) {
  const [mounted, setMounted] = useState(false);

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column.id}`,
    data: {
      type: "column",
      column,
    },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex-1 min-w-[280px] max-w-[350px] bg-zinc-900 rounded-lg flex flex-col">
      <div className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-300">{column.name}</h2>
          <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded-full">
            {column.cards.length}
          </span>
        </div>
      </div>

      <div
        ref={mounted ? setNodeRef : undefined}
        className={`flex-1 p-2 pt-0 overflow-y-auto min-h-[200px] transition-colors ${
          mounted && isOver ? "bg-zinc-800/50" : ""
        }`}
      >
        <SortableContext
          items={column.cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {column.cards.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-sm">
                No cards yet
              </div>
            ) : (
              column.cards.map((card) => (
                <Card
                  key={card.id}
                  card={card}
                  onClick={() => onCardClick(card)}
                />
              ))
            )}
          </div>
        </SortableContext>
      </div>

      <div className="p-2 pt-0">
        <AddCardForm
          onAdd={(title) => onAddCard(column.id, title)}
        />
      </div>
    </div>
  );
}
