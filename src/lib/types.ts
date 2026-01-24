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

// Workspace member role type
export type WorkspaceRole = "admin" | "member" | "viewer";

// Extended types with relations
export type IssueWithLabels = Issue & {
  labels: Label[];
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
  | "moved";

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
};
