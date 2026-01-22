"use client";

import { DndContext, DragOverlay, closestCorners } from "@dnd-kit/core";
import { Column } from "./Column";
import { Card as CardComponent } from "./Card";
import { CardModal } from "./CardModal";
import { BoardProvider, useBoardContext } from "./context/BoardContext";
import { useCardModal, useBoardDragAndDrop } from "./hooks";
import type { BoardWithColumnsAndCards } from "@/lib/types";

interface BoardProps {
  initialBoard: BoardWithColumnsAndCards;
}

export function Board({ initialBoard }: BoardProps) {
  return (
    <BoardProvider initialBoard={initialBoard}>
      <BoardContent />
    </BoardProvider>
  );
}

function BoardContent() {
  const {
    board,
    initialBoard,
    findColumn,
    addOptimistic,
    startTransition,
    addCard,
    updateCardData,
    removeCard,
    moveCardToColumn,
  } = useBoardContext();

  const { selectedCard, isOpen, openModal, closeModal } = useCardModal();

  const {
    sensors,
    activeCard,
    isOverDropzone,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useBoardDragAndDrop({
    board,
    initialBoard,
    findColumn,
    addOptimistic,
    startTransition,
    moveCardToColumn,
  });

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
          {board.columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              onCardClick={openModal}
              onAddCard={addCard}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeCard && isOverDropzone && (
            <div className="rotate-3 cursor-grabbing">
              <CardComponent card={activeCard} onClick={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <CardModal
        card={selectedCard}
        isOpen={isOpen}
        onClose={closeModal}
        onUpdate={updateCardData}
        onDelete={removeCard}
      />
    </>
  );
}
