import { db } from "./index";
import { boards, columns, labels, issues } from "./schema";

async function seed() {
  const now = new Date();

  // Create default board
  await db.insert(boards).values({
    id: "default-board",
    name: "My Board",
    identifier: "AUTO",
    issueCounter: 3,
    createdAt: now,
  });

  // Create default columns
  await db.insert(columns).values([
    { id: "col-backlog", boardId: "default-board", name: "Backlog", position: 0 },
    { id: "col-todo", boardId: "default-board", name: "Todo", position: 1 },
    { id: "col-in-progress", boardId: "default-board", name: "In Progress", position: 2 },
    { id: "col-done", boardId: "default-board", name: "Done", position: 3 },
  ]);

  // Create default labels
  await db.insert(labels).values([
    { id: "label-bug", boardId: "default-board", name: "Bug", color: "#ef4444", createdAt: now },
    { id: "label-feature", boardId: "default-board", name: "Feature", color: "#8b5cf6", createdAt: now },
    { id: "label-improvement", boardId: "default-board", name: "Improvement", color: "#3b82f6", createdAt: now },
    { id: "label-docs", boardId: "default-board", name: "Documentation", color: "#10b981", createdAt: now },
  ]);

  // Create sample issues
  await db.insert(issues).values([
    {
      id: "issue-1",
      columnId: "col-todo",
      identifier: "AUTO-1",
      title: "Set up project structure",
      description: "Initialize the project with proper folder structure and dependencies",
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
