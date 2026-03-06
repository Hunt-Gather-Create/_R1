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
  status: text("status").notNull().default("waitlisted"), // "waitlisted" | "active"
  role: text("role"),
  bio: text("bio"),
  aiCommunicationStyle: text("ai_communication_style"),
  aiCustomInstructions: text("ai_custom_instructions"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Invite Codes - reusable beta invite codes
export const inviteCodes = sqliteTable("invite_codes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  label: text("label"), // optional admin label, e.g. "Beta batch 1"
  maxUses: integer("max_uses"), // nullable = unlimited uses
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp" }), // nullable = no expiry
});

// Invite Code Claims - tracks who claimed each code
export const inviteCodeClaims = sqliteTable(
  "invite_code_claims",
  {
    inviteCodeId: text("invite_code_id")
      .notNull()
      .references(() => inviteCodes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    claimedAt: integer("claimed_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.inviteCodeId, table.userId] }),
  })
);

// Brands - user-owned brand identities (reusable across workspaces)
export const brands = sqliteTable("brands", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tagline: text("tagline"),
  description: text("description"),
  summary: text("summary"), // AI-generated short summary for AI agents
  logoUrl: text("logo_url"), // Original URL (kept for reference)
  logoStorageKey: text("logo_storage_key"), // R2 storage key for persisted logo
  logoBackground: text("logo_background"), // "light" | "dark" - recommended background
  websiteUrl: text("website_url"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  industry: text("industry"),
  // Brand guidelines (researched via AI)
  guidelines: text("guidelines"), // JSON: BrandGuidelines
  guidelinesStatus: text("guidelines_status"), // pending | processing | completed | failed | not_found
  guidelinesUpdatedAt: integer("guidelines_updated_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
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
  brandId: text("brand_id").references(() => brands.id, { onDelete: "set null" }),
  primaryColor: text("primary_color"), // Copied from brand for UI theming
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

// Workspace Invitations - email invitations to join a workspace
export const workspaceInvitations = sqliteTable("workspace_invitations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  token: text("token").notNull().unique().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending | accepted | expired | revoked
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  claimedAt: integer("claimed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

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

// Epics - grouping for planning sessions
export const epics = sqliteTable("epics", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // active, completed, canceled
  dueDate: integer("due_date", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
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
  epicId: text("epic_id").references(() => epics.id, {
    onDelete: "set null",
  }),
  // Subtask support: references parent issue (1 level only - subtasks cannot have subtasks)
  // Note: Self-reference handled at database level, not inline to avoid TS circular reference
  parentIssueId: text("parent_issue_id"),
  // Assignee - workspace member assigned to this issue
  assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
  position: integer("position").notNull(),
  sentToAI: integer("sent_to_ai", { mode: "boolean" }).notNull().default(false),
  // AI task fields - indicates AI can perform this task
  aiAssignable: integer("ai_assignable", { mode: "boolean" }).notNull().default(false),
  aiInstructions: text("ai_instructions"), // How AI should approach this task
  aiTools: text("ai_tools"), // JSON array of tool names AI should use
  aiExecutionStatus: text("ai_execution_status"), // null | "pending" | "running" | "completed" | "failed"
  aiJobId: text("ai_job_id"), // Reference to background job tracking execution
  aiExecutionResult: text("ai_execution_result"), // JSON result/output
  aiExecutionSummary: text("ai_execution_summary"), // Summary of what AI did and how it decided
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

// Token Usage - tracks AI token consumption per workspace
export const tokenUsage = sqliteTable("token_usage", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  model: text("model").notNull(), // e.g., "claude-haiku-4-5-20251001"
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  totalTokens: integer("total_tokens").notNull(),
  // Cache tokens for prompt caching (Anthropic)
  cacheCreationInputTokens: integer("cache_creation_input_tokens").default(0),
  cacheReadInputTokens: integer("cache_read_input_tokens").default(0),
  // Cost in USD cents (to avoid floating point issues)
  costCents: integer("cost_cents").notNull(),
  // Source of the usage (chat, planning, skill-generation, etc.)
  source: text("source").notNull().default("chat"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Background Jobs - tracks Inngest job execution status per workspace
export const backgroundJobs = sqliteTable("background_jobs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  functionId: text("function_id").notNull(), // Inngest function ID (e.g., "hello-world")
  functionName: text("function_name").notNull(), // Human-readable name
  runId: text("run_id").notNull().unique(), // Inngest run ID (unique per execution)
  correlationId: text("correlation_id"), // Optional: for grouping related jobs
  status: text("status").notNull().default("pending"), // pending | running | completed | failed | cancelled
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  metadata: text("metadata"), // JSON: { description, issueId, etc. }
  result: text("result"), // JSON: function return value
  error: text("error"), // Error message if failed
  attempt: integer("attempt").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(3),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Audiences - target audience groups for marketing workspaces
export const audiences = sqliteTable("audiences", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  generationStatus: text("generation_status").notNull().default("pending"), // pending | processing | completed | failed
  generationPrompt: text("generation_prompt"), // The demographic prompt used for generation
  memberCount: integer("member_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Audience Members - lightweight metadata for display (full profile in R2)
export const audienceMembers = sqliteTable("audience_members", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  audienceId: text("audience_id")
    .notNull()
    .references(() => audiences.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  avatar: text("avatar"), // URL or placeholder identifier
  age: integer("age"),
  gender: text("gender"),
  occupation: text("occupation"),
  location: text("location"),
  tagline: text("tagline"), // Short description/persona summary
  primaryPainPoint: text("primary_pain_point"),
  primaryGoal: text("primary_goal"),
  profileStorageKey: text("profile_storage_key").notNull(), // R2 key for full JSON profile
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Workspace Memories - AI-created contextual memories for chat
export const workspaceMemories = sqliteTable("workspace_memories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  tags: text("tags").notNull(), // JSON array of tag strings
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// AI Suggestions - ghost subtasks suggested by AI for issues
export const aiSuggestions = sqliteTable("ai_suggestions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  priority: integer("priority").notNull().default(4), // 0=urgent, 1=high, 2=medium, 3=low, 4=none
  toolsRequired: text("tools_required"), // JSON array - hint for which tools
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Knowledge Base folders (workspace-scoped tree)
export const knowledgeFolders = sqliteTable("knowledge_folders", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  parentFolderId: text("parent_folder_id"),
  name: text("name").notNull(),
  path: text("path").notNull(), // e.g. "product/api"
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Knowledge Base documents
export const knowledgeDocuments = sqliteTable("knowledge_documents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  folderId: text("folder_id").references(() => knowledgeFolders.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  mimeType: text("mime_type").notNull().default("text/markdown"),
  fileExtension: text("file_extension").notNull().default("md"),
  size: integer("size").notNull().default(0),
  storageKey: text("storage_key").notNull(),
  previewStorageKey: text("preview_storage_key"),
  previewMimeType: text("preview_mime_type"),
  previewStatus: text("preview_status").notNull().default("ready"),
  previewError: text("preview_error"),
  contentHash: text("content_hash"),
  summary: text("summary"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Extracted #tags for filtering and autocomplete
export const knowledgeDocumentTags = sqliteTable(
  "knowledge_document_tags",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.documentId, table.tag] }),
  })
);

// Wiki-link graph between documents
export const knowledgeDocumentLinks = sqliteTable(
  "knowledge_document_links",
  {
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    targetDocumentId: text("target_document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    linkType: text("link_type").notNull().default("wiki"), // wiki | ticket
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sourceDocumentId, table.targetDocumentId, table.linkType] }),
  })
);

// Explicit issue -> knowledge document links
export const issueKnowledgeDocuments = sqliteTable(
  "issue_knowledge_documents",
  {
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    linkedBy: text("linked_by").references(() => users.id, { onDelete: "set null" }),
    linkedAt: integer("linked_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.issueId, table.documentId] }),
  })
);

// API Keys - workspace-scoped API keys for external integrations
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(), // first 8 chars, e.g. "ak_aBcD..."
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Webhooks - workspace-scoped webhook configurations
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(), // URL-safe identifier for the endpoint path
  prompt: text("prompt").notNull(), // AI instructions for processing incoming data
  defaultStatus: text("default_status"), // optional default status override
  defaultPriority: integer("default_priority"), // optional default priority override
  defaultLabelIds: text("default_label_ids"), // JSON array of default label IDs
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Knowledge assets (images embedded in markdown docs)
export const knowledgeAssets = sqliteTable("knowledge_assets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  documentId: text("document_id").references(() => knowledgeDocuments.id, {
    onDelete: "cascade",
  }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
