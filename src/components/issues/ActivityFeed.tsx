"use client";

import { createElement } from "react";
import { format } from "date-fns";
import {
  Circle,
  ArrowRight,
  Tag,
  Clock,
  AlertCircle,
  MessageSquare,
  Plus,
  Paperclip,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/design-tokens";
import type { Activity, ActivityData, ActivityType } from "@/lib/types";

interface ActivityFeedProps {
  activities: Activity[];
  className?: string;
}

// Map activity types to icons (declared outside component to avoid recreation)
const ACTIVITY_ICON_MAP: Record<ActivityType, LucideIcon> = {
  created: Plus,
  status_changed: Circle,
  priority_changed: AlertCircle,
  label_added: Tag,
  label_removed: Tag,
  cycle_changed: Clock,
  comment_added: MessageSquare,
  moved: ArrowRight,
  attachment_added: Paperclip,
  attachment_removed: Paperclip,
  updated: Circle,
  converted_to_subtask: Circle,
  converted_to_issue: Circle,
  subtask_added: Plus,
  subtask_removed: Circle,
};

function getActivityDescription(activity: Activity): string {
  const data: ActivityData | null = activity.data
    ? JSON.parse(activity.data)
    : null;

  switch (activity.type as ActivityType) {
    case "created":
      return "created this issue";
    case "status_changed":
      const oldStatus = data?.oldValue as string;
      const newStatus = data?.newValue as string;
      return `changed status from ${STATUS_CONFIG[oldStatus as keyof typeof STATUS_CONFIG]?.label || oldStatus} to ${STATUS_CONFIG[newStatus as keyof typeof STATUS_CONFIG]?.label || newStatus}`;
    case "priority_changed":
      const oldPriority = data?.oldValue as number;
      const newPriority = data?.newValue as number;
      return `changed priority from ${PRIORITY_CONFIG[oldPriority as keyof typeof PRIORITY_CONFIG]?.label || oldPriority} to ${PRIORITY_CONFIG[newPriority as keyof typeof PRIORITY_CONFIG]?.label || newPriority}`;
    case "label_added":
      return `added label "${data?.labelName}"`;
    case "label_removed":
      return `removed label "${data?.labelName}"`;
    case "cycle_changed":
      return data?.newValue ? `added to cycle` : `removed from cycle`;
    case "comment_added":
      return "added a comment";
    case "moved":
      return "moved to another column";
    case "updated":
      return `updated ${data?.field || "issue"}`;
    case "attachment_added":
      return `added attachment "${data?.attachmentFilename}"`;
    case "attachment_removed":
      return `removed attachment "${data?.attachmentFilename}"`;
    default:
      return "made changes";
  }
}

function ActivityItem({ activity }: { activity: Activity }) {
  const description = getActivityDescription(activity);
  // Use createElement to render icon from map (avoids "component created during render" lint error)
  const IconComponent = ACTIVITY_ICON_MAP[activity.type as ActivityType] ?? Circle;

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center mt-0.5">
        {createElement(IconComponent, { className: "w-3 h-3 text-muted-foreground" })}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">User</span>{" "}
          <span className="text-muted-foreground">{description}</span>
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {format(new Date(activity.createdAt), "MMM d, h:mm a")}
        </p>
      </div>
    </div>
  );
}

export function ActivityFeed({ activities, className }: ActivityFeedProps) {
  const sortedActivities = [...activities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className={cn("space-y-0", className)}>
      {sortedActivities.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No activity yet
        </p>
      ) : (
        sortedActivities.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} />
        ))
      )}
    </div>
  );
}
