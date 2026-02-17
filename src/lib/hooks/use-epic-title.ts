"use client";

import { useMemo } from "react";
import { useBoardContext } from "@/components/board/context";

export function useEpicTitle(epicId: string | null): string | null {
  const { epics } = useBoardContext();
  return useMemo(() => {
    if (!epicId) return null;
    return epics.find((e) => e.id === epicId)?.title ?? null;
  }, [epicId, epics]);
}
