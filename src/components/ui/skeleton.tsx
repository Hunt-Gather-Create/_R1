import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

function IssueCardSkeleton() {
  return (
    <div className="bg-card rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-3" />
      </div>
      <Skeleton className="h-4 w-full" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-4 w-12 rounded-full" />
        <Skeleton className="h-4 w-12 rounded-full" />
      </div>
    </div>
  );
}

function ColumnSkeleton() {
  return (
    <div className="min-w-[280px] max-w-[320px] bg-secondary/30 rounded-lg border border-border/50 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-6 rounded-full" />
      </div>
      <div className="space-y-2">
        <IssueCardSkeleton />
        <IssueCardSkeleton />
        <IssueCardSkeleton />
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      <ColumnSkeleton />
      <ColumnSkeleton />
      <ColumnSkeleton />
      <ColumnSkeleton />
    </div>
  );
}

function ListRowSkeleton() {
  return (
    <div className="flex items-center h-9 border-b border-border/50 px-2 gap-2">
      <Skeleton className="h-4 w-4 rounded" />
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-3 w-3 rounded-full" />
      <Skeleton className="h-3 w-3" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-16 rounded-full" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 10 }).map((_, i) => (
        <ListRowSkeleton key={i} />
      ))}
    </div>
  );
}

export {
  Skeleton,
  IssueCardSkeleton,
  ColumnSkeleton,
  BoardSkeleton,
  ListRowSkeleton,
  ListSkeleton,
};
