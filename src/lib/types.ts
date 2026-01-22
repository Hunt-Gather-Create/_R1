import type {
  boards,
  columns,
  cards,
  issues,
  labels,
  cycles,
  comments,
  activities,
} from "./db/schema";
import type { Status, Priority } from "./design-tokens";

// Base types inferred from schema
export type Board = typeof boards.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type Cycle = typeof cycles.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Activity = typeof activities.$inferSelect;

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

export type ColumnWithCards = Column & {
  cards: Card[];
};

export type ColumnWithIssues = Column & {
  issues: IssueWithLabels[];
};

export type BoardWithColumnsAndCards = Board & {
  columns: ColumnWithCards[];
};

export type BoardWithColumnsAndIssues = Board & {
  columns: ColumnWithIssues[];
  labels: Label[];
  cycles: Cycle[];
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
