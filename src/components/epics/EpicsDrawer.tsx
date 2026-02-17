"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Layers, ChevronLeft, Calendar } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { StatusDot } from "@/components/issues/StatusDot";
import { PriorityIcon } from "@/components/issues/PriorityIcon";
import { SubtaskProgress } from "@/components/issues/SubtaskProgress";
import { DatePicker } from "@/components/issues/properties/DatePicker";
import { useBoardContext } from "@/components/board/context";
import { getEpicProgress } from "@/lib/actions/epics";
import { cn } from "@/lib/utils";
import type { Epic, EpicStatus, IssueWithLabels } from "@/lib/types";
import type { Status, Priority } from "@/lib/design-tokens";

const STATUS_CONFIG: Record<
  EpicStatus,
  { label: string; dotClass: string; bgClass: string }
> = {
  active: {
    label: "Active",
    dotClass: "bg-blue-400",
    bgClass: "bg-blue-500/15 text-blue-400",
  },
  completed: {
    label: "Completed",
    dotClass: "bg-green-400",
    bgClass: "bg-green-500/15 text-green-400",
  },
  canceled: {
    label: "Canceled",
    dotClass: "bg-zinc-400",
    bgClass: "bg-zinc-500/15 text-zinc-400",
  },
};

const EPIC_STATUSES: EpicStatus[] = ["active", "completed", "canceled"];

function DueDateLabel({ date }: { date: Date }) {
  const overdue = isPast(date) && !isToday(date);
  const dueToday = isToday(date);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        overdue
          ? "text-destructive"
          : dueToday
            ? "text-[var(--priority-high)]"
            : "text-muted-foreground"
      )}
    >
      <Calendar className="w-3 h-3" />
      {format(date, "MMM d")}
    </span>
  );
}

function useEpicProgress(issueIds: string[]) {
  const key = issueIds.join(",");
  return useQuery({
    queryKey: ["epicProgress", key],
    queryFn: () => getEpicProgress(issueIds),
    enabled: issueIds.length > 0,
  });
}

// ---------- Progress bar for epic cards ----------

function EpicCardProgress({ issueIds }: { issueIds: string[] }) {
  const { data: progress } = useEpicProgress(issueIds);

  if (!progress || progress.total === 0) return null;

  return <SubtaskProgress count={progress} size="sm" showBar />;
}

interface EpicsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EpicsDrawer({ open, onOpenChange }: EpicsDrawerProps) {
  const { board, epics, updateEpic, selectIssue } = useBoardContext();
  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);

  const selectedEpic = selectedEpicId
    ? epics.find((e) => e.id === selectedEpicId) ?? null
    : null;

  // Collect issues per epic
  const issuesByEpic = useMemo(() => {
    const map = new Map<string, IssueWithLabels[]>();
    for (const col of board.columns) {
      for (const issue of col.issues) {
        if (issue.epicId) {
          const list = map.get(issue.epicId) ?? [];
          list.push(issue);
          map.set(issue.epicId, list);
        }
      }
    }
    return map;
  }, [board.columns]);

  const handleClose = useCallback(() => {
    setSelectedEpicId(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleBack = useCallback(() => {
    setSelectedEpicId(null);
  }, []);

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        className={cn(
          "p-0 flex flex-col transition-[width] duration-200",
          selectedEpic
            ? "w-[720px] max-w-[95vw] sm:max-w-[720px]"
            : "w-[500px] max-w-[90vw] sm:max-w-[500px]"
        )}
        hideCloseButton
      >
        {selectedEpic ? (
          <EpicDetail
            epic={selectedEpic}
            issues={issuesByEpic.get(selectedEpic.id) ?? []}
            onBack={handleBack}
            onClose={handleClose}
            onUpdateEpic={updateEpic}
            onSelectIssue={selectIssue}
          />
        ) : (
          <EpicList
            epics={epics}
            issuesByEpic={issuesByEpic}
            onSelect={setSelectedEpicId}
            onClose={handleClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------- Epic List View ----------

function EpicList({
  epics,
  issuesByEpic,
  onSelect,
  onClose,
}: {
  epics: Epic[];
  issuesByEpic: Map<string, IssueWithLabels[]>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <SheetHeader className="flex-shrink-0 px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold">
            <Layers className="w-4 h-4 text-purple-400" />
            Epics
          </SheetTitle>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
        {epics.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <Layers className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              No epics yet
            </p>
            <p className="text-xs text-muted-foreground max-w-[240px]">
              Epics are created from AI planning sessions to group related
              issues together.
            </p>
          </div>
        ) : (
          epics.map((epic) => {
            const status =
              STATUS_CONFIG[epic.status as EpicStatus] ?? STATUS_CONFIG.active;
            const epicIssues = issuesByEpic.get(epic.id) ?? [];
            const issueIds = epicIssues.map((i) => i.id);

            return (
              <button
                key={epic.id}
                onClick={() => onSelect(epic.id)}
                className="w-full text-left rounded-lg border border-border bg-card p-4 space-y-2 hover:border-border/80 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground leading-snug">
                    {epic.title}
                  </h3>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-full flex-shrink-0",
                      status.bgClass
                    )}
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        status.dotClass
                      )}
                    />
                    {status.label}
                  </span>
                </div>

                {epic.description ? (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {epic.description}
                  </p>
                ) : null}

                {/* Progress bar */}
                {issueIds.length > 0 && (
                  <EpicCardProgress issueIds={issueIds} />
                )}

                <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1">
                  <span>
                    {epicIssues.length}{" "}
                    {epicIssues.length === 1 ? "issue" : "issues"}
                  </span>
                  {epic.dueDate ? (
                    <>
                      <span className="text-border">&middot;</span>
                      <DueDateLabel date={new Date(epic.dueDate)} />
                    </>
                  ) : null}
                  {epic.createdAt ? (
                    <>
                      <span className="text-border">&middot;</span>
                      <span>
                        Created{" "}
                        {new Date(epic.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

// ---------- Epic Detail View ----------

function EpicDetail({
  epic,
  issues,
  onBack,
  onClose,
  onUpdateEpic,
  onSelectIssue,
}: {
  epic: Epic;
  issues: IssueWithLabels[];
  onBack: () => void;
  onClose: () => void;
  onUpdateEpic: (
    epicId: string,
    data: { title?: string; description?: string; status?: EpicStatus; dueDate?: Date | null }
  ) => Promise<void>;
  onSelectIssue: (issue: IssueWithLabels) => void;
}) {
  const [title, setTitle] = useState(epic.title);
  const [description, setDescription] = useState(epic.description ?? "");
  const [isSaving, setIsSaving] = useState(false);

  // Reset local state when epic changes
  const [prevEpicId, setPrevEpicId] = useState(epic.id);
  if (epic.id !== prevEpicId) {
    setPrevEpicId(epic.id);
    setTitle(epic.title);
    setDescription(epic.description ?? "");
  }

  const issueIds = useMemo(() => issues.map((i) => i.id), [issues]);
  const { data: progress } = useEpicProgress(issueIds);

  const handleTitleBlur = useCallback(async () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== epic.title) {
      setIsSaving(true);
      await onUpdateEpic(epic.id, { title: trimmed });
      setIsSaving(false);
    }
  }, [title, epic.title, epic.id, onUpdateEpic]);

  const handleDescriptionBlur = useCallback(async () => {
    if (description !== (epic.description ?? "")) {
      setIsSaving(true);
      await onUpdateEpic(epic.id, { description });
      setIsSaving(false);
    }
  }, [description, epic.description, epic.id, onUpdateEpic]);

  const handleStatusChange = useCallback(
    async (newStatus: EpicStatus) => {
      if (newStatus !== epic.status) {
        setIsSaving(true);
        await onUpdateEpic(epic.id, { status: newStatus });
        setIsSaving(false);
      }
    },
    [epic.status, epic.id, onUpdateEpic]
  );

  const handleDueDateChange = useCallback(
    async (date: Date | null) => {
      setIsSaving(true);
      await onUpdateEpic(epic.id, { dueDate: date });
      setIsSaving(false);
    },
    [epic.id, onUpdateEpic]
  );

  const handleIssueClick = useCallback(
    (issue: IssueWithLabels) => {
      onSelectIssue(issue);
      onClose();
    },
    [onSelectIssue, onClose]
  );

  return (
    <>
      {/* Header */}
      <SheetHeader className="flex-shrink-0 px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <SheetTitle className="flex items-center gap-2 text-base font-semibold">
              <Layers className="w-4 h-4 text-purple-400" />
              Epic
            </SheetTitle>
            {isSaving && (
              <span className="text-[11px] text-muted-foreground">
                Saving...
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </SheetHeader>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-5 space-y-6">
          {/* Title */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-full text-lg font-semibold text-foreground bg-transparent border-none outline-none placeholder:text-muted-foreground"
            placeholder="Epic title"
          />

          {/* Progress */}
          {progress && progress.total > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Progress
              </label>
              <SubtaskProgress count={progress} size="md" showBar />
            </div>
          )}

          {/* Status selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Status
            </label>
            <div className="flex gap-2">
              {EPIC_STATUSES.map((s) => {
                const cfg = STATUS_CONFIG[s];
                const isActive = epic.status === s;
                return (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors",
                      isActive
                        ? cn(cfg.bgClass, "border-current/20")
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        isActive ? cfg.dotClass : "bg-muted-foreground/40"
                      )}
                    />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Due date */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Due Date
            </label>
            <DatePicker
              value={epic.dueDate ?? null}
              onChange={handleDueDateChange}
            />
          </div>

          {/* Description - side-by-side markdown editor */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Description
            </label>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              onBlur={handleDescriptionBlur}
              placeholder="Describe this epic..."
              minHeight={200}
            />
          </div>

          {/* Linked Issues */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Issues
              </label>
              <span className="text-[11px] text-muted-foreground">
                {issues.length} {issues.length === 1 ? "issue" : "issues"}
              </span>
            </div>

            {issues.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No issues linked to this epic yet.
              </p>
            ) : (
              <div className="rounded-lg border border-border divide-y divide-border">
                {issues.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    onClick={() => handleIssueClick(issue)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Meta */}
          {epic.createdAt ? (
            <div className="pt-2 border-t border-border">
              <p className="text-[11px] text-muted-foreground">
                Created{" "}
                {new Date(epic.createdAt).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---------- Issue Row with per-issue subtask progress ----------

function IssueRow({
  issue,
  onClick,
}: {
  issue: IssueWithLabels;
  onClick: () => void;
}) {
  const { data: subtaskProgress } = useEpicProgress([issue.id]);

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors group space-y-1.5"
    >
      <div className="flex items-center gap-3">
        <StatusDot status={issue.status as Status} size="sm" />
        <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0">
          {issue.identifier}
        </span>
        <span className="text-sm text-foreground truncate flex-1 group-hover:text-foreground/90">
          {issue.title}
        </span>
        <PriorityIcon priority={issue.priority as Priority} size="sm" />
      </div>
      {subtaskProgress && subtaskProgress.total > 0 && (
        <div className="pl-6">
          <SubtaskProgress count={subtaskProgress} size="sm" showBar />
        </div>
      )}
    </button>
  );
}
