import type {
  columns,
  issues,
  labels,
  cycles,
  comments,
  activities,
  users,
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  attachments,
  workspaceSkills,
  workspaceMcpServers,
  workspaceChats,
  workspaceChatAttachments,
  brands,
  backgroundJobs,
  aiSuggestions,
  audiences,
  audienceMembers,
  workspaceMemories,
  epics,
  knowledgeFolders,
  knowledgeDocuments,
  knowledgeDocumentTags,
  knowledgeDocumentLinks,
  issueKnowledgeDocuments,
  knowledgeAssets,
  inviteCodes,
  inviteCodeClaims,
  apiKeys,
  webhooks,
} from "./db/schema";
import type { Status, Priority, CommunicationStyle } from "./design-tokens";

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
export type Attachment = typeof attachments.$inferSelect;
export type WorkspaceSkill = typeof workspaceSkills.$inferSelect;
export type WorkspaceMcpServer = typeof workspaceMcpServers.$inferSelect;
export type WorkspaceChat = typeof workspaceChats.$inferSelect;
export type WorkspaceChatAttachment = typeof workspaceChatAttachments.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type Epic = typeof epics.$inferSelect;
export type EpicStatus = "active" | "completed" | "canceled";
export type CreateEpicInput = { title: string; description?: string; dueDate?: Date };
export type KnowledgeFolder = typeof knowledgeFolders.$inferSelect;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type KnowledgeDocumentTag = typeof knowledgeDocumentTags.$inferSelect;
export type KnowledgeDocumentLink = typeof knowledgeDocumentLinks.$inferSelect;
export type IssueKnowledgeDocument = typeof issueKnowledgeDocuments.$inferSelect;
export type KnowledgeAsset = typeof knowledgeAssets.$inferSelect;

// Invite codes
export type InviteCode = typeof inviteCodes.$inferSelect;
export type InviteCodeClaim = typeof inviteCodeClaims.$inferSelect;

// API Keys
export type ApiKey = typeof apiKeys.$inferSelect;
export type CreateApiKeyInput = {
  name: string;
  expiresAt?: Date;
};

// Webhooks
export type Webhook = typeof webhooks.$inferSelect;
export type CreateWebhookInput = {
  name: string;
  prompt: string;
  slug?: string;
  defaultStatus?: string;
  defaultPriority?: number;
  defaultLabelIds?: string[];
};
export type UpdateWebhookInput = Partial<Omit<CreateWebhookInput, "slug">> & {
  isActive?: boolean;
};
export type UserStatus = "waitlisted" | "active";

// Workspace invitations
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type WorkspaceInvitationStatus = "pending" | "accepted" | "expired" | "revoked";

// User profile types
export type AICommunicationStyle = CommunicationStyle;

export type UpdateUserProfileInput = {
  role?: string | null;
  bio?: string | null;
  aiCommunicationStyle?: AICommunicationStyle | null;
  aiCustomInstructions?: string | null;
};

export type UserProfileWithWorkspaces = User & {
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    purpose: string;
    role: string;
  }>;
};

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
  epics: Epic[];
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
  epicId?: string;
  labelIds?: string[];
  parentIssueId?: string; // For creating subtasks
  assigneeId?: string | null; // Workspace member assigned to this issue
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
  | "assignee_changed"
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
  summary?: string;
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

// Brand Guidelines - extracted from online brand resources
export interface BrandGuidelines {
  logo?: {
    rules?: string[];
    clearSpace?: string;
    minimumSize?: string;
    incorrectUsage?: string[];
  };
  colors?: {
    primary?: { name?: string; hex: string; usage?: string };
    secondary?: { name?: string; hex: string; usage?: string };
    palette?: Array<{ name?: string; hex: string; usage?: string }>;
  };
  typography?: {
    primaryFont?: string;
    secondaryFont?: string;
    headingFont?: string;
    bodyFont?: string;
    rules?: string[];
  };
  voiceAndTone?: {
    characteristics?: string[];
    doUse?: string[];
    dontUse?: string[];
  };
  imagery?: {
    style?: string;
    guidelines?: string[];
  };
  sources?: Array<{ url: string; title?: string; fetchedAt: string }>;
  lastUpdated: string;
  confidence: "high" | "medium" | "low";
  summary?: string;
}

export type GuidelinesStatus = "pending" | "processing" | "completed" | "failed" | "not_found";

// AI Suggestions - ghost subtasks suggested by AI
export type AISuggestion = typeof aiSuggestions.$inferSelect;

// AI execution status for AI-assignable subtasks
export type AIExecutionStatus = "pending" | "running" | "completed" | "failed" | null;

// Parsed AI suggestion with tools array instead of JSON string
export interface AISuggestionWithTools extends Omit<AISuggestion, "toolsRequired"> {
  toolsRequired: string[] | null;
  priority: number; // 0=urgent, 1=high, 2=medium, 3=low, 4=none
}

// Extended issue type for AI subtasks with parsed JSON fields
export type IssueWithAI = Issue & {
  aiAssignable: boolean;
  aiInstructions: string | null;
  aiTools: string[] | null; // Parsed from JSON
  aiExecutionStatus: AIExecutionStatus;
  aiJobId: string | null;
  aiExecutionResult: unknown | null; // Parsed from JSON
};

// Audience types
export type Audience = typeof audiences.$inferSelect;
export type AudienceMember = typeof audienceMembers.$inferSelect;
export type AudienceGenerationStatus = "pending" | "processing" | "completed" | "failed";

export type AudienceWithMembers = Audience & {
  members: AudienceMember[];
};

// Workspace Memories - AI-created contextual memories
export type WorkspaceMemory = typeof workspaceMemories.$inferSelect;

export type CreateWorkspaceMemoryInput = {
  content: string;
  tags: string[];
};

export type UpdateWorkspaceMemoryInput = {
  content?: string;
  tags?: string[];
};

// R2 Chat Storage Types
export type R2ChatType = "issue" | "workspace" | "soul";

export interface R2ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string; // JSON-serialized via serializeMessageParts()
  createdAt: string;
}

export interface R2ChatConversation {
  version: 1;
  metadata: {
    workspaceId: string;
    chatType: R2ChatType;
    userId: string;
    entityId: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  };
  messages: R2ChatMessage[];
}

export type KnowledgeDocumentWithContent = KnowledgeDocument & {
  content: string | null;
  isMarkdown: boolean;
  previewUrl: string | null;
  downloadUrl: string;
  previewStatus: "ready" | "pending" | "failed";
  previewError: string | null;
  tags: string[];
  backlinks: KnowledgeDocument[];
};

export type KnowledgeFolderWithStats = KnowledgeFolder & {
  documentCount: number;
};
