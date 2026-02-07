"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IssueRow } from "./IssueRow";
import { useMounted } from "@/lib/hooks";
import type { IssueWithLabels } from "@/lib/types";

interface SortableIssueRowProps {
  issue: IssueWithLabels;
  isSelected?: boolean;
  onSelect?: () => void;
  onClick?: () => void;
  onSendToAI?: () => void;
}

export function SortableIssueRow({
  issue,
  isSelected,
  onSelect,
  onClick,
  onSendToAI,
}: SortableIssueRowProps) {
  const mounted = useMounted();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id });

  const style = mounted
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
      }
    : undefined;

  return (
    <div
      ref={mounted ? setNodeRef : undefined}
      style={style}
      {...(mounted ? attributes : {})}
      {...(mounted ? listeners : {})}
    >
      <IssueRow
        issue={issue}
        isSelected={isSelected}
        onSelect={onSelect}
        onClick={onClick}
        onSendToAI={onSendToAI}
        isDragging={isDragging}
      />
    </div>
  );
}
