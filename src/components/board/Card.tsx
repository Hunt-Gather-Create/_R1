"use client";

import { useState, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card as CardType } from "@/lib/types";

interface CardProps {
  card: CardType;
  onClick: () => void;
}

export function Card({ card, onClick }: CardProps) {
  const [mounted, setMounted] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: {
      type: "card",
      card,
    },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const style = mounted
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(mounted ? attributes : {})}
      {...(mounted ? listeners : {})}
      onClick={onClick}
      className={`bg-zinc-800 rounded-lg p-3 cursor-grab active:cursor-grabbing shadow-sm hover:bg-zinc-750 hover:ring-1 hover:ring-zinc-600 transition-all ${
        isDragging ? "ring-2 ring-blue-500 shadow-lg" : ""
      }`}
    >
      <h3 className="text-sm font-medium text-zinc-100">{card.title}</h3>
      {card.description && (
        <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
          {card.description}
        </p>
      )}
    </div>
  );
}
