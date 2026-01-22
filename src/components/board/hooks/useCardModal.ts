"use client";

import { useState, useCallback } from "react";
import type { Card } from "@/lib/types";

export function useCardModal() {
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openModal = useCallback((card: Card) => {
    setSelectedCard(card);
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    selectedCard,
    isOpen,
    openModal,
    closeModal,
  };
}
