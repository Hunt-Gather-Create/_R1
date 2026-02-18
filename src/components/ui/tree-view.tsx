"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type TreeDataItem = {
  id: string;
  name: string;
  icon?: React.ComponentType<{ className?: string }>;
  selectedIcon?: React.ComponentType<{ className?: string }>;
  openIcon?: React.ComponentType<{ className?: string }>;
  children?: TreeDataItem[];
  actions?: React.ReactNode;
  onClick?: () => void;
  draggable?: boolean;
  droppable?: boolean;
  disabled?: boolean;
  className?: string;
};

export type TreeRenderItemParams = {
  item: TreeDataItem;
  level: number;
  isLeaf: boolean;
  isSelected: boolean;
  isOpen: boolean;
  hasChildren: boolean;
};

type TreeViewProps = React.HTMLAttributes<HTMLDivElement> & {
  data: TreeDataItem[] | TreeDataItem;
  selectedItemId?: string;
  onSelectChange?: (item: TreeDataItem | undefined) => void;
  expandAll?: boolean;
  defaultNodeIcon?: React.ComponentType<{ className?: string }>;
  defaultLeafIcon?: React.ComponentType<{ className?: string }>;
  renderItem?: (params: TreeRenderItemParams) => React.ReactNode;
  onItemDrop?: (source: TreeDataItem, target: TreeDataItem) => void;
};

function flattenNodeIds(items: TreeDataItem[]): string[] {
  const ids: string[] = [];

  const walk = (nodes: TreeDataItem[]) => {
    for (const node of nodes) {
      ids.push(node.id);
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };

  walk(items);
  return ids;
}

function findAncestorIds(items: TreeDataItem[], targetId: string): string[] {
  const path: string[] = [];

  const walk = (nodes: TreeDataItem[]): boolean => {
    for (const node of nodes) {
      path.push(node.id);
      if (node.id === targetId) {
        return true;
      }
      if (node.children?.length && walk(node.children)) {
        return true;
      }
      path.pop();
    }
    return false;
  };

  walk(items);
  path.pop();
  return path;
}

function getNodeIcon(
  item: TreeDataItem,
  isSelected: boolean,
  isOpen: boolean,
  hasChildren: boolean,
  defaultNodeIcon?: React.ComponentType<{ className?: string }>,
  defaultLeafIcon?: React.ComponentType<{ className?: string }>
) {
  if (isSelected && item.selectedIcon) return item.selectedIcon;
  if (isOpen && item.openIcon) return item.openIcon;
  if (item.icon) return item.icon;
  return hasChildren ? defaultNodeIcon : defaultLeafIcon;
}

function flattenTreeItems(items: TreeDataItem[]): TreeDataItem[] {
  const flat: TreeDataItem[] = [];
  const walk = (nodes: TreeDataItem[]) => {
    for (const node of nodes) {
      flat.push(node);
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(items);
  return flat;
}

export function TreeView({
  data,
  selectedItemId,
  onSelectChange,
  expandAll,
  defaultNodeIcon,
  defaultLeafIcon,
  renderItem,
  onItemDrop,
  className,
  ...props
}: TreeViewProps) {
  const items = React.useMemo(() => (Array.isArray(data) ? data : [data]), [data]);
  const [internalSelectedItemId, setInternalSelectedItemId] = React.useState<string | undefined>(
    selectedItemId
  );
  const [expandedItemIds, setExpandedItemIds] = React.useState<Set<string>>(() => {
    if (expandAll) {
      return new Set(flattenNodeIds(items));
    }

    if (!selectedItemId) {
      return new Set();
    }

    return new Set(findAncestorIds(items, selectedItemId));
  });
  const [draggedItemId, setDraggedItemId] = React.useState<string | null>(null);

  const itemById = React.useMemo(() => {
    const map = new Map<string, TreeDataItem>();
    for (const item of flattenTreeItems(items)) {
      map.set(item.id, item);
    }
    return map;
  }, [items]);

  React.useEffect(() => {
    if (selectedItemId === undefined) return;
    setInternalSelectedItemId(selectedItemId);

    const ancestorIds = findAncestorIds(items, selectedItemId);
    if (ancestorIds.length === 0) return;

    setExpandedItemIds((current) => {
      const next = new Set(current);
      for (const ancestorId of ancestorIds) {
        next.add(ancestorId);
      }
      return next;
    });
  }, [items, selectedItemId]);

  React.useEffect(() => {
    if (!expandAll) return;
    setExpandedItemIds(new Set(flattenNodeIds(items)));
  }, [expandAll, items]);

  const activeSelectedItemId = selectedItemId ?? internalSelectedItemId;

  const handleSelect = React.useCallback(
    (item: TreeDataItem | undefined) => {
      if (selectedItemId === undefined) {
        setInternalSelectedItemId(item?.id);
      }
      onSelectChange?.(item);
      item?.onClick?.();
    },
    [onSelectChange, selectedItemId]
  );

  const toggleExpanded = React.useCallback((id: string) => {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleItemDrop = React.useCallback(
    (sourceId: string, targetId: string) => {
      if (!onItemDrop) return;
      const source = itemById.get(sourceId);
      const target = itemById.get(targetId);
      if (!source || !target || source.id === target.id) return;
      onItemDrop(source, target);
    },
    [itemById, onItemDrop]
  );

  return (
    <div className={cn("relative overflow-hidden", className)} role="tree" {...props}>
      <ul className="space-y-1">
        {items.map((item) => (
          <TreeNodeItem
            key={item.id}
            item={item}
            level={0}
            selectedItemId={activeSelectedItemId}
            expandedItemIds={expandedItemIds}
            onToggleExpanded={toggleExpanded}
            onSelect={handleSelect}
            defaultLeafIcon={defaultLeafIcon}
            defaultNodeIcon={defaultNodeIcon}
            renderItem={renderItem}
            draggedItemId={draggedItemId}
            setDraggedItemId={setDraggedItemId}
            onItemDrop={handleItemDrop}
          />
        ))}
      </ul>
    </div>
  );
}

type TreeNodeItemProps = {
  item: TreeDataItem;
  level: number;
  selectedItemId?: string;
  expandedItemIds: Set<string>;
  onToggleExpanded: (id: string) => void;
  onSelect: (item: TreeDataItem | undefined) => void;
  defaultNodeIcon?: React.ComponentType<{ className?: string }>;
  defaultLeafIcon?: React.ComponentType<{ className?: string }>;
  renderItem?: (params: TreeRenderItemParams) => React.ReactNode;
  draggedItemId: string | null;
  setDraggedItemId: (id: string | null) => void;
  onItemDrop: (sourceId: string, targetId: string) => void;
};

function TreeNodeItem({
  item,
  level,
  selectedItemId,
  expandedItemIds,
  onToggleExpanded,
  onSelect,
  defaultNodeIcon,
  defaultLeafIcon,
  renderItem,
  draggedItemId,
  setDraggedItemId,
  onItemDrop,
}: TreeNodeItemProps) {
  const hasChildren = !!item.children?.length;
  const isSelected = selectedItemId === item.id;
  const isOpen = hasChildren && expandedItemIds.has(item.id);
  const canDrop = item.droppable !== false && !item.disabled;
  const isDragging = draggedItemId === item.id;
  const [isDragOver, setIsDragOver] = React.useState(false);
  const Icon = getNodeIcon(
    item,
    isSelected,
    isOpen,
    hasChildren,
    defaultNodeIcon,
    defaultLeafIcon
  );
  const iconElement = Icon
    ? React.createElement(Icon, { className: "h-4 w-4 shrink-0" })
    : null;

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    if (!item.draggable || item.disabled) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    setDraggedItemId(item.id);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedItemId || draggedItemId === item.id || !canDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    if (isDragOver) setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!draggedItemId || draggedItemId === item.id || !canDrop) return;
    event.preventDefault();
    setIsDragOver(false);
    onItemDrop(draggedItemId, item.id);
    setDraggedItemId(null);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
    setIsDragOver(false);
  };

  return (
    <li>
      <div
        className={cn(
          "group relative flex min-h-8 items-center rounded-md pr-2",
          "hover:bg-accent/60",
          isSelected && "bg-accent text-accent-foreground",
          isDragOver && "bg-primary/20",
          isDragging && "opacity-60",
          item.disabled && "cursor-not-allowed opacity-50",
          item.className
        )}
        style={{ paddingLeft: 8 + level * 14 }}
        draggable={!!item.draggable && !item.disabled}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        {hasChildren ? (
          <button
            type="button"
            className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(item.id);
            }}
            disabled={item.disabled}
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
          </button>
        ) : (
          <span className="mr-1 inline-block h-5 w-5" />
        )}

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
          onClick={() => {
            if (item.disabled) return;
            onSelect(item);
          }}
          disabled={item.disabled}
        >
          {renderItem ? (
            renderItem({
              item,
              level,
              isLeaf: !hasChildren,
              isSelected,
              isOpen,
              hasChildren,
            })
          ) : (
            <>
              {iconElement}
              <span className="truncate text-sm">{item.name}</span>
            </>
          )}
        </button>

        {item.actions ? (
          <div
            className={cn(
              "ml-1",
              isSelected ? "opacity-100" : "opacity-0 transition-opacity group-hover:opacity-100"
            )}
          >
            {item.actions}
          </div>
        ) : null}
      </div>

      {hasChildren && isOpen ? (
        <ul className="space-y-1">
          {item.children?.map((child) => (
            <TreeNodeItem
              key={child.id}
              item={child}
              level={level + 1}
              selectedItemId={selectedItemId}
              expandedItemIds={expandedItemIds}
              onToggleExpanded={onToggleExpanded}
              onSelect={onSelect}
              defaultLeafIcon={defaultLeafIcon}
              defaultNodeIcon={defaultNodeIcon}
              renderItem={renderItem}
              draggedItemId={draggedItemId}
              setDraggedItemId={setDraggedItemId}
              onItemDrop={onItemDrop}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
