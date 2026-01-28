import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// Users - synced from WorkOS
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Workspaces - renamed from boards, adds owner
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  identifier: text("identifier").notNull().default("AUTO"), // For issue IDs like AUTO-123
  issueCounter: integer("issue_counter").notNull().default(0),
  purpose: text("purpose").notNull().default("software"), // "software" | "marketing"
  soul: text("soul"), // JSON-serialized WorkspaceSoul
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Workspace Members - team membership
export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // admin, member, viewer
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.userId] }),
  })
);

// Columns - status columns within workspaces
export const columns = sqliteTable("columns", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  // Maps this column to a workflow status (backlog, todo, in_progress, done, canceled)
  // Used to auto-move issues when their status changes
  status: text("status"),
});

// Cycles - time-boxed iterations (sprints)
// Defined before issues to avoid circular reference
export const cycles = sqliteTable("cycles", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
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
  cycleId: text("cycle_id").references(() => cycles.id, {
    onDelete: "set null",
  }),
  // Subtask support: references parent issue (1 level only - subtasks cannot have subtasks)
  // Note: Self-reference handled at database level, not inline to avoid TS circular reference
  parentIssueId: text("parent_issue_id"),
  position: integer("position").notNull(),
  sentToAI: integer("sent_to_ai", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Labels - for categorizing issues
export const labels = sqliteTable("labels", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
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
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
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
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  type: text("type").notNull(), // created, updated, status_changed, priority_changed, etc.
  data: text("data"), // JSON string with details
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Chat messages - AI chat history per issue
export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(), // Message text or JSON for tool calls
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Attachments - files attached to issues
export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Workspace Skills - custom AI skills per workspace
export const workspaceSkills = sqliteTable("workspace_skills", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  content: text("content").notNull(),
  // JSON array of asset objects: { filename, storageKey, mimeType }
  assets: text("assets"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Workspace MCP Servers - enabled MCP integrations per workspace
export const workspaceMcpServers = sqliteTable("workspace_mcp_servers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  serverKey: text("server_key").notNull(), // e.g., "exa"
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Workspace Chats - conversation threads within a workspace
export const workspaceChats = sqliteTable("workspace_chats", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Workspace Chat Messages - messages within a workspace chat thread
export const workspaceChatMessages = sqliteTable("workspace_chat_messages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  chatId: text("chat_id")
    .notNull()
    .references(() => workspaceChats.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Workspace Chat Attachments - files generated by AI in workspace chat
export const workspaceChatAttachments = sqliteTable("workspace_chat_attachments", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  chatId: text("chat_id")
    .notNull()
    .references(() => workspaceChats.id, { onDelete: "cascade" }),
  messageId: text("message_id"), // Optional: link to specific message
  filename: text("filename").notNull(),
  content: text("content").notNull(), // The actual file content
  mimeType: text("mime_type").notNull().default("text/markdown"),
  size: integer("size").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Soul Chat Messages - conversation history for soul configuration
export const soulChatMessages = sqliteTable("soul_chat_messages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(), // JSON-serialized message parts
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
