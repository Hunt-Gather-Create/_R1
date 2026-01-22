import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

// Boards - workspace containers
export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  identifier: text("identifier").notNull().default("AUTO"), // For issue IDs like AUTO-123
  issueCounter: integer("issue_counter").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Columns - status columns within boards
export const columns = sqliteTable("columns", {
  id: text("id").primaryKey(),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
});

// Cycles - time-boxed iterations (sprints)
// Defined before issues to avoid circular reference
export const cycles = sqliteTable("cycles", {
  id: text("id").primaryKey(),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  startDate: integer("start_date", { mode: "timestamp" }),
  endDate: integer("end_date", { mode: "timestamp" }),
  status: text("status").notNull().default("upcoming"), // upcoming, active, completed
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Issues - the main entity (renamed from cards)
export const issues = sqliteTable("issues", {
  id: text("id").primaryKey(),
  columnId: text("column_id")
    .notNull()
    .references(() => columns.id, { onDelete: "cascade" }),
  identifier: text("identifier").notNull(), // e.g., "AUTO-123"
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"), // backlog, todo, in_progress, done, canceled
  priority: integer("priority").notNull().default(4), // 0=urgent, 1=high, 2=medium, 3=low, 4=none
  estimate: integer("estimate"), // Story points
  dueDate: integer("due_date", { mode: "timestamp" }),
  cycleId: text("cycle_id").references(() => cycles.id, { onDelete: "set null" }),
  position: integer("position").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Labels - for categorizing issues
export const labels = sqliteTable("labels", {
  id: text("id").primaryKey(),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(), // Hex color
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Issue-Label junction table
export const issueLabels = sqliteTable(
  "issue_labels",
  {
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.issueId, table.labelId] }),
  })
);

// Comments - discussion on issues
export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Activities - change history
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // created, updated, status_changed, priority_changed, etc.
  data: text("data"), // JSON string with details
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Keep cards table for backward compatibility during migration
export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  columnId: text("column_id")
    .notNull()
    .references(() => columns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  position: integer("position").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// User stories - AI-generated acceptance criteria
export const userStories = sqliteTable("user_stories", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  story: text("story").notNull(),
  acceptanceCriteria: text("acceptance_criteria"),
  position: integer("position").notNull(),
});
