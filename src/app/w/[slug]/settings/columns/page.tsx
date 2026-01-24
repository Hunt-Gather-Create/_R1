"use client";

import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  updateColumn,
  deleteColumn,
  reorderColumns,
  getColumnIssueCounts,
} from "@/lib/actions/columns";
import { useSettingsContext } from "../context";
import { SortableColumnRow } from "./SortableColumnRow";
import { SystemColumnRow } from "./SystemColumnRow";
import { AddColumnForm } from "./AddColumnForm";
import type { Column } from "@/lib/types";

export default function ColumnsSettingsPage() {
  const { workspace, columns, isAdmin, refreshColumns } = useSettingsContext();
  const [issueCounts, setIssueCounts] = useState<Record<string, number>>({});

  const regularColumns = columns.filter((c) => !c.isSystem);
  const systemColumns = columns.filter((c) => c.isSystem);

  useEffect(() => {
    async function fetchCounts() {
      const columnIds = columns.map((c) => c.id);
      const counts = await getColumnIssueCounts(columnIds);
      setIssueCounts(counts);
    }
    if (columns.length > 0) {
      fetchCounts();
    }
  }, [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = regularColumns.findIndex((c) => c.id === active.id);
      const newIndex = regularColumns.findIndex((c) => c.id === over.id);

      const newOrder = arrayMove(regularColumns, oldIndex, newIndex);
      const columnIds = newOrder.map((c) => c.id);

      if (workspace) {
        await reorderColumns(workspace.id, columnIds);
        await refreshColumns();
      }
    }
  };

  const handleEdit = async (column: Column, name: string) => {
    await updateColumn(column.id, { name });
    await refreshColumns();
  };

  const handleDelete = async (column: Column) => {
    const count = issueCounts[column.id] || 0;
    const message =
      count > 0
        ? `Are you sure you want to delete the column "${column.name}"? ${count} ${count === 1 ? "issue" : "issues"} will be moved to the Orphaned column.`
        : `Are you sure you want to delete the column "${column.name}"?`;

    if (!window.confirm(message)) return;

    try {
      await deleteColumn(column.id);
      await refreshColumns();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete column");
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Columns</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage columns for organizing issues on the board
        </p>
      </div>

      {isAdmin && workspace && (
        <div className="mb-6">
          <AddColumnForm
            workspaceId={workspace.id}
            onCreated={refreshColumns}
          />
        </div>
      )}

      <div className="rounded-lg border border-border bg-card mb-6">
        {regularColumns.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No columns yet. {isAdmin ? "Create one to get started." : ""}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={regularColumns.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {regularColumns.map((column) => (
                <SortableColumnRow
                  key={column.id}
                  column={column}
                  isAdmin={isAdmin}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  issueCount={issueCounts[column.id]}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {systemColumns.length > 0 && (
        <>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            System Columns (auto-managed)
          </h2>
          <div className="rounded-lg border border-border overflow-hidden">
            {systemColumns.map((column) => (
              <SystemColumnRow
                key={column.id}
                column={column}
                issueCount={issueCounts[column.id]}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
