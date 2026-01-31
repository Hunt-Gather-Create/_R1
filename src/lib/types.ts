import type {
  columns,
  issues,
  labels,
  cycles,
  comments,
  activities,
  chatMessages,
  users,
  workspaces,
  workspaceMembers,
  attachments,
  workspaceSkills,
  workspaceMcpServers,
  workspaceChats,
  workspaceChatMessages,
  workspaceChatAttachments,
  brands,
  backgroundJobs,
} from "./db/schema";
import type { Status, Priority } from "./design-tokens";

// Base types inferred from schema
export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type Cycle = typeof cycles.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type WorkspaceSkill = typeof workspaceSkills.$inferSelect;
export type WorkspaceMcpServer = typeof workspaceMcpServers.$inferSelect;
export type WorkspaceChat = typeof workspaceChats.$inferSelect;
export type WorkspaceChatMessage = typeof workspaceChatMessages.$inferSelect;
export type WorkspaceChatAttachment = typeof workspaceChatAttachments.$inferSelect;
export type Brand = typeof brands.$inferSelect;

// Attachment with signed URL for display
export type AttachmentWithUrl = Attachment & { url: string };

// Workspace member role type
export type WorkspaceRole = "admin" | "member" | "viewer";

// Extended types with relations
export type IssueWithLabels = Issue & {
  labels: Label[];
  subtasks?: IssueWithLabels[]; // Optional, loaded when needed
};

// Subtask count for progress tracking
export type SubtaskCount = {
  total: number;
  completed: number;
};

export type IssueWithRelations = Issue & {
  labels: Label[];
  comments: Comment[];
  activities: Activity[];
  cycle?: Cycle | null;
};

export type ColumnWithIssues = Column & {
  issues: IssueWithLabels[];
};

// Workspace types
export type WorkspaceMemberWithUser = WorkspaceMember & {
  user: User;
};

export type WorkspaceWithColumnsAndIssues = Workspace & {
  columns: ColumnWithIssues[];
  labels: Label[];
  cycles: Cycle[];
};

// Legacy alias for backward compatibility
export type BoardWithColumnsAndIssues = WorkspaceWithColumnsAndIssues;

export type WorkspaceWithMembers = Workspace & {
  members: WorkspaceMemberWithUser[];
};

// Input types for creating/updating
export type CreateIssueInput = {
  title: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  estimate?: number;
  dueDate?: Date;
  cycleId?: string;
  labelIds?: string[];
  parentIssueId?: string; // For creating subtasks
};

export type UpdateIssueInput = Partial<CreateIssueInput>;

export type CreateLabelInput = {
  name: string;
  color: string;
};

export type CreateCycleInput = {
  name: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
};

export type CreateCommentInput = {
  body: string;
};

export type SkillAsset = {
  filename: string;
  storageKey: string;
  mimeType: string;
};

export type CreateWorkspaceSkillInput = {
  name: string;
  description: string;
  content: string;
  assets?: SkillAsset[];
};

export type UpdateWorkspaceSkillInput = {
  name?: string;
  description?: string;
  content?: string;
  isEnabled?: boolean;
};

// Activity types for change history
export type ActivityType =
  | "created"
  | "updated"
  | "status_changed"
  | "priority_changed"
  | "label_added"
  | "label_removed"
  | "cycle_changed"
  | "comment_added"
  | "moved"
  | "subtask_added"
  | "subtask_removed"
  | "converted_to_subtask"
  | "converted_to_issue"
  | "attachment_added"
  | "attachment_removed";

export type ActivityData = {
  field?: string;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  labelId?: string;
  labelName?: string;
  cycleId?: string;
  cycleName?: string;
  fromColumn?: string;
  toColumn?: string;
  subtaskId?: string;
  subtaskIdentifier?: string;
  subtaskTitle?: string;
  parentIssueId?: string;
  parentIdentifier?: string;
  attachmentId?: string;
  attachmentFilename?: string;
};

// Workspace Soul - AI personality/system prompt configuration
export interface WorkspaceSoul {
  name: string; // Chatbot name (e.g., "Luna")
  personality: string; // Interaction style description
  primaryGoals: string[]; // 3-5 main objectives
  tone: "professional" | "friendly" | "casual" | "formal";
  responseLength: "concise" | "moderate" | "detailed";
  domainExpertise: string[]; // Areas of expertise
  terminology: Record<string, string>; // Domain-specific terms
  doRules: string[]; // Things the AI SHOULD do
  dontRules: string[]; // Things the AI should NOT do
  greeting?: string; // Optional custom greeting
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Brand search result - for disambiguation during brand research
export interface BrandSearchResult {
  name: string;
  description: string;
  websiteUrl: string;
  logoUrl?: string;
}

// Input type for creating/updating brands
export type CreateBrandInput = {
  name: string;
  tagline?: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  industry?: string;
};

export type UpdateBrandInput = Partial<CreateBrandInput>;

// Background Jobs - Inngest job tracking
export type BackgroundJob = typeof backgroundJobs.$inferSelect;

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface JobMetadata {
  description?: string;
  issueId?: string;
  issueIdentifier?: string;
  [key: string]: unknown;
}

export interface JobsQueryOptions {
  status?: JobStatus | JobStatus[];
  limit?: number;
  offset?: number;
}
