"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDashboardData } from "@/lib/actions/dashboard";
import type { DashboardData, TimeRange } from "@/lib/actions/dashboard";
import { Badge } from "@/components/ui/badge";
import { WorkspaceDigest } from "./WorkspaceDigest";

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "day", label: "Last 24h" },
  { value: "week", label: "Last Week" },
  { value: "month", label: "Last Month" },
];

export function DashboardContent({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [timeRange, setTimeRange] = useState<TimeRange>(initialData.timeRange);
  const [isPending, startTransition] = useTransition();

  const handleTimeRangeChange = (newRange: TimeRange) => {
    setTimeRange(newRange);
    startTransition(async () => {
      const newData = await getDashboardData(newRange);
      setData(newData);
    });
  };

  // Global stats
  const totalAssigned = data.workspaces.reduce((sum, ws) => sum + ws.stats.totalAssigned, 0);
  const totalInProgress = data.workspaces.reduce((sum, ws) => sum + ws.stats.inProgress, 0);
  const totalCompleted = data.workspaces.reduce((sum, ws) => sum + ws.stats.completed, 0);
  const totalCreated = data.workspaces.reduce((sum, ws) => sum + ws.stats.created, 0);
  const totalUnassigned = data.workspaces.reduce((sum, ws) => sum + ws.stats.unassigned, 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              <ArrowLeft className="w-3 h-3" />
              Projects
            </Link>
            <h1 className="text-2xl font-bold text-foreground">My Dashboard</h1>
            {data.user.firstName && (
              <p className="text-sm text-muted-foreground mt-1">
                Welcome back, {data.user.firstName}
              </p>
            )}
          </div>

          {/* Time range tabs */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
            {TIME_RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => handleTimeRangeChange(option.value)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  timeRange === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Global stats */}
        {data.workspaces.length > 0 && (
          <div className="flex items-center gap-3 mb-6">
            <Badge variant="secondary" className="text-xs">
              {totalAssigned} assigned
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {totalInProgress} in progress
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {totalCompleted} completed
            </Badge>
            {totalCreated > 0 && (
              <Badge variant="secondary" className="text-xs">
                {totalCreated} new
              </Badge>
            )}
            {totalUnassigned > 0 && (
              <Badge variant="outline" className="text-xs">
                {totalUnassigned} unassigned
              </Badge>
            )}
          </div>
        )}

        {/* Workspace digests */}
        <div className={cn("space-y-6", isPending && "opacity-60 transition-opacity")}>
          {data.workspaces.map((ws) => (
            <WorkspaceDigest
              key={ws.workspace.id}
              data={ws}
              timeRange={timeRange}
            />
          ))}
        </div>

        {/* Empty state */}
        {data.workspaces.length === 0 && (
          <div className="text-center py-16">
            <h3 className="text-lg font-medium text-foreground mb-2">
              No activity found
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              {timeRange === "day"
                ? "No workspace activity in the last 24 hours."
                : timeRange === "week"
                  ? "No workspace activity in the last week."
                  : "No workspace activity in the last month."}
            </p>
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              View Projects
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
