"use server";

import { cache } from "react";
import { db } from "../db";
import {
  workspaces,
  workspaceMembers,
  columns,
  issues,
  issueLabels,
  labels,
  activities,
  users,
} from "../db/schema";
import { eq, and, inArray, gte, isNull } from "drizzle-orm";
import { requireAuth } from "./workspace";

// ---------- Types ----------

export type TimeRange = "day" | "week" | "month";

export interface DashboardIssue {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: number;
  dueDate: Date | null;
  columnId: string;
  assigneeName: string | null;
  labels: { id: string; name: string; color: string }[];
}

export interface DashboardActivity {
  id: string;
  issueId: string;
  issueIdentifier: string;
  userId: string | null;
  userName: string | null;
  type: string;
  data: string | null;
  createdAt: Date;
}

export interface WorkspaceDashboardData {
  workspace: {
    id: string;
    name: string;
    slug: string;
    purpose: string;
  };
  myIssues: DashboardIssue[];
  newIssues: DashboardIssue[];
  unassignedIssues: DashboardIssue[];
  recentActivities: DashboardActivity[];
  stats: {
    totalAssigned: number;
    inProgress: number;
    completed: number;
    created: number;
    unassigned: number;
  };
}

export interface DashboardData {
  user: { id: string; firstName: string | null; lastName: string | null; email: string };
  workspaces: WorkspaceDashboardData[];
  timeRange: TimeRange;
}

// ---------- Helpers ----------

function getSinceDate(timeRange: TimeRange): Date {
  const now = new Date();
  switch (timeRange) {
    case "day":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      throw new Error(`Invalid time range: ${timeRange}`);
  }
}

// ---------- Main Dashboard Query ----------

export const getDashboardData = cache(
  async (timeRange: TimeRange): Promise<DashboardData> => {
    const user = await requireAuth();
    const sinceDate = getSinceDate(timeRange);
    const userInfo = { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email };

    // 1. Get all workspace memberships
    const memberships = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id));

    if (memberships.length === 0) {
      return { user: userInfo, workspaces: [], timeRange };
    }

    const workspaceIds = memberships.map((m) => m.workspaceId);

    // 2. Parallel batch: workspaces + columns
    const [allWorkspaces, allColumns] = await Promise.all([
      db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          slug: workspaces.slug,
          purpose: workspaces.purpose,
        })
        .from(workspaces)
        .where(inArray(workspaces.id, workspaceIds)),
      db
        .select()
        .from(columns)
        .where(inArray(columns.workspaceId, workspaceIds)),
    ]);

    if (allColumns.length === 0) {
      return {
        user: userInfo,
        workspaces: [],
        timeRange,
      };
    }

    // 3. Build column lookup maps in a single pass
    const columnToWorkspace = new Map<string, string>();
    const columnToStatus = new Map<string, string | null>();
    for (const col of allColumns) {
      columnToWorkspace.set(col.id, col.workspaceId);
      columnToStatus.set(col.id, col.status);
    }

    const allColumnIds = allColumns.map((c) => c.id);

    // 4. Fetch user's assigned issues + unassigned issues + new issues in parallel
    const issueFields = {
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      status: issues.status,
      priority: issues.priority,
      dueDate: issues.dueDate,
      columnId: issues.columnId,
      assigneeId: issues.assigneeId,
      createdAt: issues.createdAt,
    };

    const [myIssues, unassignedIssues, newIssues] = await Promise.all([
      db
        .select(issueFields)
        .from(issues)
        .where(
          and(
            inArray(issues.columnId, allColumnIds),
            eq(issues.assigneeId, user.id)
          )
        ),
      db
        .select(issueFields)
        .from(issues)
        .where(
          and(
            inArray(issues.columnId, allColumnIds),
            isNull(issues.assigneeId)
          )
        ),
      db
        .select(issueFields)
        .from(issues)
        .where(
          and(
            inArray(issues.columnId, allColumnIds),
            gte(issues.createdAt, sinceDate)
          )
        ),
    ]);

    // 5. Batch fetch labels for all relevant issues
    const relevantIssueIds = [
      ...new Set([
        ...myIssues.map((i) => i.id),
        ...unassignedIssues.map((i) => i.id),
        ...newIssues.map((i) => i.id),
      ]),
    ];
    const allIssueLabelRows =
      relevantIssueIds.length > 0
        ? await db
            .select({
              issueId: issueLabels.issueId,
              labelId: labels.id,
              labelName: labels.name,
              labelColor: labels.color,
            })
            .from(issueLabels)
            .innerJoin(labels, eq(issueLabels.labelId, labels.id))
            .where(inArray(issueLabels.issueId, relevantIssueIds))
        : [];

    // Build issueId -> labels map
    const labelsByIssueId = new Map<string, { id: string; name: string; color: string }[]>();
    for (const row of allIssueLabelRows) {
      const existing = labelsByIssueId.get(row.issueId);
      const label = { id: row.labelId, name: row.labelName, color: row.labelColor };
      if (existing) {
        existing.push(label);
      } else {
        labelsByIssueId.set(row.issueId, [label]);
      }
    }

    // 6. Batch fetch all workspace issues (minimal) for activity context
    const allWorkspaceIssues = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        columnId: issues.columnId,
      })
      .from(issues)
      .where(inArray(issues.columnId, allColumnIds));

    const allIssueIds = allWorkspaceIssues.map((i) => i.id);
    const issueIdentifierMap = new Map(allWorkspaceIssues.map((i) => [i.id, i.identifier]));
    const issueColumnMap = new Map(allWorkspaceIssues.map((i) => [i.id, i.columnId]));

    // 7. Batch fetch activities within time range
    const allActivities =
      allIssueIds.length > 0
        ? await db
            .select()
            .from(activities)
            .where(
              and(
                inArray(activities.issueId, allIssueIds),
                gte(activities.createdAt, sinceDate)
              )
            )
        : [];

    // 8. Fetch user names for activity attribution
    const activityUserIds = [...new Set(allActivities.map((a) => a.userId).filter(Boolean))] as string[];
    const activityUsers =
      activityUserIds.length > 0
        ? await db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, activityUserIds))
        : [];
    const userNameMap = new Map(
      activityUsers.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
      ])
    );

    // 9. Group everything by workspace
    const workspaceMap = new Map<string, WorkspaceDashboardData>();
    for (const ws of allWorkspaces) {
      workspaceMap.set(ws.id, {
        workspace: ws,
        myIssues: [],
        newIssues: [],
        unassignedIssues: [],
        recentActivities: [],
        stats: { totalAssigned: 0, inProgress: 0, completed: 0, created: 0, unassigned: 0 },
      });
    }

    // Batch fetch assignee names for all issues
    const allAssigneeIds = [
      ...new Set(
        [...myIssues, ...unassignedIssues, ...newIssues]
          .map((i) => i.assigneeId)
          .filter(Boolean) as string[]
      ),
    ];
    const assigneeUsers =
      allAssigneeIds.length > 0
        ? await db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, allAssigneeIds))
        : [];
    const assigneeNameMap = new Map(
      assigneeUsers.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
      ])
    );

    // Helper to resolve issue with effective status, labels, and assignee name
    const resolveIssue = (issue: typeof myIssues[number]) => {
      const effectiveStatus = columnToStatus.get(issue.columnId) ?? issue.status;
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        status: effectiveStatus,
        priority: issue.priority,
        dueDate: issue.dueDate,
        columnId: issue.columnId,
        assigneeName: issue.assigneeId ? (assigneeNameMap.get(issue.assigneeId) ?? null) : null,
        labels: labelsByIssueId.get(issue.id) ?? [],
      };
    };

    // Group my assigned issues
    for (const issue of myIssues) {
      const wsId = columnToWorkspace.get(issue.columnId);
      if (!wsId) continue;
      const wsData = workspaceMap.get(wsId);
      if (!wsData) continue;

      const resolved = resolveIssue(issue);
      wsData.myIssues.push(resolved);

      wsData.stats.totalAssigned++;
      if (resolved.status === "in_progress") wsData.stats.inProgress++;
      if (resolved.status === "done") wsData.stats.completed++;
    }

    // Group new issues (created in time range)
    for (const issue of newIssues) {
      const wsId = columnToWorkspace.get(issue.columnId);
      if (!wsId) continue;
      const wsData = workspaceMap.get(wsId);
      if (!wsData) continue;

      wsData.newIssues.push(resolveIssue(issue));
      wsData.stats.created++;
    }

    // Group unassigned issues (exclude done/canceled)
    for (const issue of unassignedIssues) {
      const wsId = columnToWorkspace.get(issue.columnId);
      if (!wsId) continue;
      const wsData = workspaceMap.get(wsId);
      if (!wsData) continue;

      const resolved = resolveIssue(issue);
      if (resolved.status === "done" || resolved.status === "canceled") continue;

      wsData.unassignedIssues.push(resolved);
      wsData.stats.unassigned++;
    }

    // Group activities
    for (const activity of allActivities) {
      const columnId = issueColumnMap.get(activity.issueId);
      if (!columnId) continue;
      const wsId = columnToWorkspace.get(columnId);
      if (!wsId) continue;
      const wsData = workspaceMap.get(wsId);
      if (!wsData) continue;

      wsData.recentActivities.push({
        id: activity.id,
        issueId: activity.issueId,
        issueIdentifier: issueIdentifierMap.get(activity.issueId) ?? "",
        userId: activity.userId,
        userName: activity.userId ? userNameMap.get(activity.userId) ?? null : null,
        type: activity.type,
        data: activity.data,
        createdAt: activity.createdAt,
      });
    }

    // Sort activities by date descending
    for (const wsData of workspaceMap.values()) {
      wsData.recentActivities.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
    }

    // 10. Filter out workspaces with nothing to show
    const activeWorkspaces = [...workspaceMap.values()].filter(
      (ws) =>
        ws.myIssues.length > 0 ||
        ws.newIssues.length > 0 ||
        ws.unassignedIssues.length > 0 ||
        ws.recentActivities.length > 0
    );

    return {
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email },
      workspaces: activeWorkspaces,
      timeRange,
    };
  }
);

// ---------- AI Summary Context ----------

export async function getWorkspaceSummaryContext(
  workspaceId: string,
  timeRange: TimeRange
) {
  const user = await requireAuth();
  const sinceDate = getSinceDate(timeRange);

  // Verify membership
  const membership = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.id)
      )
    )
    .get();

  if (!membership) {
    throw new Error("Access denied");
  }

  // Parallel fetch workspace info, columns, members
  const [workspace, workspaceColumns, members] = await Promise.all([
    db
      .select({ id: workspaces.id, name: workspaces.name, purpose: workspaces.purpose })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get(),
    db
      .select()
      .from(columns)
      .where(eq(columns.workspaceId, workspaceId)),
    db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
  ]);

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  // Fetch member names
  const memberUserIds = members.map((m) => m.userId);
  const memberUsers =
    memberUserIds.length > 0
      ? await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, memberUserIds))
      : [];
  const memberNameMap = new Map(
    memberUsers.map((u) => [
      u.id,
      [u.firstName, u.lastName].filter(Boolean).join(" ") || "Unknown",
    ])
  );

  const columnIds = workspaceColumns.map((c) => c.id);
  const columnNameMap = new Map(workspaceColumns.map((c) => [c.id, c.name]));
  const columnStatusMap = new Map(workspaceColumns.map((c) => [c.id, c.status]));

  // Fetch all issues and activities
  const [allIssues, allActivities] = await Promise.all([
    columnIds.length > 0
      ? db
          .select({
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            status: issues.status,
            priority: issues.priority,
            assigneeId: issues.assigneeId,
            columnId: issues.columnId,
          })
          .from(issues)
          .where(inArray(issues.columnId, columnIds))
      : Promise.resolve([]),
    columnIds.length > 0
      ? db
          .select()
          .from(activities)
          .where(
            and(
              inArray(
                activities.issueId,
                db
                  .select({ id: issues.id })
                  .from(issues)
                  .where(inArray(issues.columnId, columnIds))
              ),
              gte(activities.createdAt, sinceDate)
            )
          )
      : Promise.resolve([]),
  ]);

  // Resolve assignee names
  const assigneeIds = [...new Set(allIssues.map((i) => i.assigneeId).filter(Boolean))] as string[];
  const assigneeUsers =
    assigneeIds.length > 0
      ? await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, assigneeIds))
      : [];
  const assigneeNameMap = new Map(
    assigneeUsers.map((u) => [
      u.id,
      [u.firstName, u.lastName].filter(Boolean).join(" ") || "Unknown",
    ])
  );

  // Activity user IDs (may not be in memberNameMap already)
  const activityUserIds = [...new Set(allActivities.map((a) => a.userId).filter(Boolean))] as string[];
  const missingUserIds = activityUserIds.filter((id) => !memberNameMap.has(id) && !assigneeNameMap.has(id));
  if (missingUserIds.length > 0) {
    const extraUsers = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(inArray(users.id, missingUserIds));
    for (const u of extraUsers) {
      memberNameMap.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || "Unknown");
    }
  }
  // Merge assignee names into memberNameMap for unified lookup
  for (const [id, name] of assigneeNameMap) {
    if (!memberNameMap.has(id)) memberNameMap.set(id, name);
  }

  const issueIdMap = new Map(allIssues.map((i) => [i.id, i.identifier]));

  return {
    workspace: { name: workspace.name, purpose: workspace.purpose },
    members: members.map((m) => ({
      name: memberNameMap.get(m.userId) ?? "Unknown",
      role: m.role,
    })),
    issues: allIssues.map((i) => ({
      identifier: i.identifier,
      title: i.title,
      // Derive status from column (source of truth after drag-drop moves)
      status: columnStatusMap.get(i.columnId) ?? i.status,
      priority: i.priority,
      assignee: i.assigneeId ? (memberNameMap.get(i.assigneeId) ?? "Unassigned") : "Unassigned",
      column: columnNameMap.get(i.columnId) ?? "Unknown",
    })),
    activities: allActivities
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map((a) => ({
        type: a.type,
        issueIdentifier: issueIdMap.get(a.issueId) ?? "",
        userName: a.userId ? (memberNameMap.get(a.userId) ?? "Unknown") : "System",
        data: a.data,
        createdAt: a.createdAt.toISOString(),
      })),
  };
}
