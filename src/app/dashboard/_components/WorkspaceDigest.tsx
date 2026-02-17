"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/issues/StatusDot";
import { PriorityIcon } from "@/components/issues/PriorityIcon";
import type { Status, Priority } from "@/lib/design-tokens";
import type { WorkspaceDashboardData, TimeRange } from "@/lib/actions/dashboard";
import { WorkspaceSummary } from "./WorkspaceSummary";

const INITIAL_ISSUES_SHOWN = 5;
const INITIAL_ACTIVITIES_SHOWN = 5;

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatActivityType(type: string): string {
  switch (type) {
    case "created": return "created";
    case "updated": return "updated";
    case "status_changed": return "changed status of";
    case "priority_changed": return "changed priority of";
    case "assignee_changed": return "reassigned";
    case "label_added": return "labeled";
    case "label_removed": return "unlabeled";
    case "comment_added": return "commented on";
    case "moved": return "moved";
    default: return type.replace(/_/g, " ");
  }
}

function formatDueDate(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / 86400000);

  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= 7) return `in ${diffDays}d`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function IssueRow({
  issue,
  slug,
}: {
  issue: WorkspaceDashboardData["myIssues"][number];
  slug: string;
}) {
  return (
    <Link
      href={`/w/${slug}`}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group"
    >
      <span className="text-xs text-muted-foreground font-mono w-16 flex-shrink-0 truncate">
        {issue.identifier}
      </span>
      <StatusDot status={issue.status as Status} size="sm" />
      <PriorityIcon priority={issue.priority as Priority} size="sm" />
      <span className="text-sm text-foreground truncate flex-1">
        {issue.title}
      </span>
      {issue.dueDate && (
        <span
          className={cn(
            "text-[10px] flex-shrink-0",
            new Date(issue.dueDate) < new Date()
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {formatDueDate(new Date(issue.dueDate))}
        </span>
      )}
    </Link>
  );
}

function CollapsibleIssueList({
  title,
  issues,
  slug,
  initialShown = INITIAL_ISSUES_SHOWN,
}: {
  title: string;
  issues: WorkspaceDashboardData["myIssues"];
  slug: string;
  initialShown?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  if (issues.length === 0) return null;

  const visible = showAll ? issues : issues.slice(0, initialShown);
  const hiddenCount = issues.length - initialShown;

  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {title}
      </h4>
      <div className="space-y-0.5">
        {visible.map((issue) => (
          <IssueRow key={issue.id} issue={issue} slug={slug} />
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 px-2 py-1 transition-colors"
        >
          {showAll ? (
            <>
              <ChevronDown className="w-3 h-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronRight className="w-3 h-3" />
              Show {hiddenCount} more
            </>
          )}
        </button>
      )}
    </div>
  );
}

export function WorkspaceDigest({
  data,
  timeRange,
}: {
  data: WorkspaceDashboardData;
  timeRange: TimeRange;
}) {
  const [showAllActivities, setShowAllActivities] = useState(false);

  const visibleActivities = showAllActivities
    ? data.recentActivities
    : data.recentActivities.slice(0, INITIAL_ACTIVITIES_SHOWN);
  const hiddenActivityCount = data.recentActivities.length - INITIAL_ACTIVITIES_SHOWN;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={`/w/${data.workspace.slug}`}
              className="text-base font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
            >
              {data.workspace.name}
              <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100" />
            </Link>
            <Badge variant="outline" className="text-[10px] capitalize">
              {data.workspace.purpose}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {data.stats.totalAssigned} assigned
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {data.stats.inProgress} in progress
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {data.stats.completed} done
            </Badge>
            {data.stats.created > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {data.stats.created} new
              </Badge>
            )}
            {data.stats.unassigned > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {data.stats.unassigned} unassigned
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* My Issues */}
        <CollapsibleIssueList
          title="My Issues"
          issues={data.myIssues}
          slug={data.workspace.slug}
        />

        {/* Newly Created Issues */}
        <CollapsibleIssueList
          title="New Issues"
          issues={data.newIssues}
          slug={data.workspace.slug}
        />

        {/* Unassigned Issues */}
        <CollapsibleIssueList
          title="Unassigned Issues"
          issues={data.unassignedIssues}
          slug={data.workspace.slug}
        />

        {/* AI Summary */}
        <WorkspaceSummary
          workspaceId={data.workspace.id}
          timeRange={timeRange}
        />

        {/* Recent Activity */}
        {data.recentActivities.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Recent Activity
            </h4>
            <div className="space-y-0.5">
              {visibleActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center gap-2 px-2 py-1 text-xs"
                >
                  <span className="text-muted-foreground flex-shrink-0 w-12 text-right">
                    {formatRelativeTime(new Date(activity.createdAt))}
                  </span>
                  <span className="text-foreground/80 truncate">
                    <span className="font-medium">{activity.userName ?? "Someone"}</span>
                    {" "}{formatActivityType(activity.type)}{" "}
                    <span className="font-mono text-muted-foreground">{activity.issueIdentifier}</span>
                  </span>
                </div>
              ))}
            </div>
            {hiddenActivityCount > 0 && (
              <button
                onClick={() => setShowAllActivities(!showAllActivities)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 px-2 py-1 transition-colors"
              >
                {showAllActivities ? (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-3 h-3" />
                    Show {hiddenActivityCount} more
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
