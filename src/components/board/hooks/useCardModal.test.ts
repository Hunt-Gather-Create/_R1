import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCardModal } from "./useCardModal";
import type { Card } from "@/lib/types";

const mockCard: Card = {
  id: "card-1",
  columnId: "col-1",
  title: "Test Card",
  description: "Test Description",
  position: 0,
  createdAt: new Date("2024-01-01"),
};

describe("useCardModal", () => {
  it("should initialize with closed modal and no selected card", () => {
    const { result } = renderHook(() => useCardModal());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.selectedCard).toBeNull();
  });

  it("should open modal and set selected card when openModal is called", () => {
    const { result } = renderHook(() => useCardModal());

    act(() => {
      result.current.openModal(mockCard);
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.selectedCard).toEqual(mockCard);
  });

  it("should close modal when closeModal is called", () => {
    const { result } = renderHook(() => useCardModal());

    act(() => {
      result.current.openModal(mockCard);
    });

    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.closeModal();
    });

    expect(result.current.isOpen).toBe(false);
  });

  it("should keep selected card after closing modal", () => {
    const { result } = renderHook(() => useCardModal());

    act(() => {
      result.current.openModal(mockCard);
    });

    act(() => {
      result.current.closeModal();
    });

    expect(result.current.selectedCard).toEqual(mockCard);
  });

  it("should update selected card when opening with different card", () => {
    const { result } = renderHook(() => useCardModal());

    const anotherCard: Card = {
      ...mockCard,
      id: "card-2",
      title: "Another Card",
    };

    act(() => {
      result.current.openModal(mockCard);
    });

    act(() => {
      result.current.openModal(anotherCard);
    });

    expect(result.current.selectedCard).toEqual(anotherCard);
  });
});
