import { db } from "./index";
import {
  users,
  workspaces,
  workspaceMembers,
  columns,
  labels,
  issues,
} from "./schema";

async function seed() {
  const now = new Date();

  // Create system user
  await db.insert(users).values({
    id: "system-user",
    email: "system@auto-kanban.local",
    firstName: "System",
    lastName: "User",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
  });

  // Create default workspace
  await db.insert(workspaces).values({
    id: "default-workspace",
    name: "My Workspace",
    slug: "my-workspace",
    identifier: "AUTO",
    issueCounter: 3,
    ownerId: "system-user",
    createdAt: now,
    updatedAt: now,
  });

  // Create workspace membership
  await db.insert(workspaceMembers).values({
    workspaceId: "default-workspace",
    userId: "system-user",
    role: "admin",
    createdAt: now,
  });

  // Create default columns
  await db.insert(columns).values([
    {
      id: "col-backlog",
      workspaceId: "default-workspace",
      name: "Backlog",
      position: 0,
      status: "backlog",
    },
    {
      id: "col-todo",
      workspaceId: "default-workspace",
      name: "Todo",
      position: 1,
      status: "todo",
    },
    {
      id: "col-in-progress",
      workspaceId: "default-workspace",
      name: "In Progress",
      position: 2,
      status: "in_progress",
    },
    {
      id: "col-done",
      workspaceId: "default-workspace",
      name: "Done",
      position: 3,
      status: "done",
    },
  ]);

  // Create default labels
  await db.insert(labels).values([
    {
      id: "label-bug",
      workspaceId: "default-workspace",
      name: "Bug",
      color: "#ef4444",
      createdAt: now,
    },
    {
      id: "label-feature",
      workspaceId: "default-workspace",
      name: "Feature",
      color: "#8b5cf6",
      createdAt: now,
    },
    {
      id: "label-improvement",
      workspaceId: "default-workspace",
      name: "Improvement",
      color: "#3b82f6",
      createdAt: now,
    },
    {
      id: "label-docs",
      workspaceId: "default-workspace",
      name: "Documentation",
      color: "#10b981",
      createdAt: now,
    },
  ]);

  // Create sample issues
  await db.insert(issues).values([
    {
      id: "issue-1",
      columnId: "col-todo",
      identifier: "AUTO-1",
      title: "Set up project structure",
      description:
        "Initialize the project with proper folder structure and dependencies",
      status: "todo",
      priority: 2,
      position: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "issue-2",
      columnId: "col-in-progress",
      identifier: "AUTO-2",
      title: "Implement authentication",
      description: "Add user authentication with email/password",
      status: "in_progress",
      priority: 1,
      position: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "issue-3",
      columnId: "col-backlog",
      identifier: "AUTO-3",
      title: "Add dark mode toggle",
      description: "Allow users to switch between light and dark themes",
      status: "backlog",
      priority: 3,
      position: 0,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  console.log("Database seeded successfully!");
}

seed().catch(console.error);
