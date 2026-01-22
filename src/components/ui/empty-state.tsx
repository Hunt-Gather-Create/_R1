import { cn } from "@/lib/utils";
import { Inbox, Search, Filter, FileText, Plus } from "lucide-react";
import { Button } from "./button";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 text-center",
        className
      )}
    >
      {icon && (
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-medium mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">
          {description}
        </p>
      )}
      {action && (
        <Button size="sm" onClick={action.onClick}>
          <Plus className="w-4 h-4 mr-1" />
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function NoIssuesFound({ onCreateIssue }: { onCreateIssue?: () => void }) {
  return (
    <EmptyState
      icon={<Inbox className="w-6 h-6 text-muted-foreground" />}
      title="No issues yet"
      description="Create your first issue to get started tracking your work"
      action={
        onCreateIssue
          ? { label: "Create issue", onClick: onCreateIssue }
          : undefined
      }
    />
  );
}

export function NoSearchResults() {
  return (
    <EmptyState
      icon={<Search className="w-6 h-6 text-muted-foreground" />}
      title="No results found"
      description="Try adjusting your search or filters to find what you're looking for"
    />
  );
}

export function NoFilterResults({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <EmptyState
      icon={<Filter className="w-6 h-6 text-muted-foreground" />}
      title="No issues match your filters"
      description="Try removing some filters to see more results"
      action={{ label: "Clear filters", onClick: onClearFilters }}
    />
  );
}

export function NoComments() {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
      <p className="text-sm">No comments yet</p>
      <p className="text-xs mt-1">Start the conversation</p>
    </div>
  );
}
