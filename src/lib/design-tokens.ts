// Linear-style design tokens for consistent styling

export const STATUS = {
  BACKLOG: "backlog",
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  DONE: "done",
  CANCELED: "canceled",
} as const;

export type Status = (typeof STATUS)[keyof typeof STATUS];

export const STATUS_CONFIG: Record<
  Status,
  { label: string; color: string; bgColor: string }
> = {
  [STATUS.BACKLOG]: {
    label: "Backlog",
    color: "text-status-backlog",
    bgColor: "bg-status-backlog/20",
  },
  [STATUS.TODO]: {
    label: "Todo",
    color: "text-status-todo",
    bgColor: "bg-status-todo/20",
  },
  [STATUS.IN_PROGRESS]: {
    label: "In Progress",
    color: "text-status-in-progress",
    bgColor: "bg-status-in-progress/20",
  },
  [STATUS.DONE]: {
    label: "Done",
    color: "text-status-done",
    bgColor: "bg-status-done/20",
  },
  [STATUS.CANCELED]: {
    label: "Canceled",
    color: "text-status-canceled",
    bgColor: "bg-status-canceled/20",
  },
};

export const PRIORITY = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
} as const;

export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

export const PRIORITY_CONFIG: Record<
  Priority,
  { label: string; color: string; bgColor: string; icon: string }
> = {
  [PRIORITY.URGENT]: {
    label: "Urgent",
    color: "text-priority-urgent",
    bgColor: "bg-priority-urgent/20",
    icon: "!!!",
  },
  [PRIORITY.HIGH]: {
    label: "High",
    color: "text-priority-high",
    bgColor: "bg-priority-high/20",
    icon: "!!",
  },
  [PRIORITY.MEDIUM]: {
    label: "Medium",
    color: "text-priority-medium",
    bgColor: "bg-priority-medium/20",
    icon: "!",
  },
  [PRIORITY.LOW]: {
    label: "Low",
    color: "text-priority-low",
    bgColor: "bg-priority-low/20",
    icon: "—",
  },
  [PRIORITY.NONE]: {
    label: "No Priority",
    color: "text-priority-none",
    bgColor: "bg-priority-none/20",
    icon: "···",
  },
};

// Default label colors for Linear-style labels
export const LABEL_COLORS = [
  { name: "Red", value: "#ef4444", bg: "bg-red-500/20", text: "text-red-400" },
  {
    name: "Orange",
    value: "#f97316",
    bg: "bg-orange-500/20",
    text: "text-orange-400",
  },
  {
    name: "Yellow",
    value: "#eab308",
    bg: "bg-yellow-500/20",
    text: "text-yellow-400",
  },
  {
    name: "Green",
    value: "#22c55e",
    bg: "bg-green-500/20",
    text: "text-green-400",
  },
  {
    name: "Blue",
    value: "#3b82f6",
    bg: "bg-blue-500/20",
    text: "text-blue-400",
  },
  {
    name: "Purple",
    value: "#a855f7",
    bg: "bg-purple-500/20",
    text: "text-purple-400",
  },
  {
    name: "Pink",
    value: "#ec4899",
    bg: "bg-pink-500/20",
    text: "text-pink-400",
  },
  {
    name: "Gray",
    value: "#6b7280",
    bg: "bg-gray-500/20",
    text: "text-gray-400",
  },
] as const;

// Keyboard shortcuts
export const SHORTCUTS = {
  COMMAND_PALETTE: "mod+k",
  CREATE_ISSUE: "c",
  AI_PLANNING: "p",
  SEARCH: "/",
  GO_TO_BOARD: "g b",
  GO_TO_LIST: "g l",
  TOGGLE_SIDEBAR: "[",
  ESCAPE: "escape",
} as const;

// View types
export const VIEW = {
  BOARD: "board",
  LIST: "list",
  TIMELINE: "timeline",
} as const;

export type ViewType = (typeof VIEW)[keyof typeof VIEW];

// Group by options
export const GROUP_BY = {
  STATUS: "status",
  PRIORITY: "priority",
  LABEL: "label",
  CYCLE: "cycle",
  EPIC: "epic",
  NONE: "none",
} as const;

export type GroupBy = (typeof GROUP_BY)[keyof typeof GROUP_BY];

// Workspace purpose types
export const WORKSPACE_PURPOSE = {
  SOFTWARE: "software",
  MARKETING: "marketing",
  SALES: "sales",
  CUSTOM: "custom",
} as const;

export type WorkspacePurpose =
  (typeof WORKSPACE_PURPOSE)[keyof typeof WORKSPACE_PURPOSE];

// Template workspace purposes (excludes custom since it doesn't use static templates)
export type TemplateWorkspacePurpose = Exclude<WorkspacePurpose, "custom">;

export const PURPOSE_CONFIG: Record<
  TemplateWorkspacePurpose,
  {
    label: string;
    description: string;
    defaultColumns: Array<{ name: string; status: Status | null }>;
    defaultLabels: Array<{ name: string; color: string }>;
  }
> = {
  software: {
    label: "Software Development",
    description: "Track bugs, features, and technical tasks",
    defaultColumns: [
      { name: "Backlog", status: STATUS.BACKLOG },
      { name: "Todo", status: STATUS.TODO },
      { name: "In Progress", status: STATUS.IN_PROGRESS },
      { name: "Done", status: STATUS.DONE },
    ],
    defaultLabels: [
      { name: "Bug", color: "#ef4444" },
      { name: "Feature", color: "#3b82f6" },
      { name: "Improvement", color: "#22c55e" },
      { name: "Documentation", color: "#a855f7" },
    ],
  },
  marketing: {
    label: "Marketing",
    description: "Manage campaigns, content, and creative projects",
    defaultColumns: [
      { name: "Ideas", status: STATUS.BACKLOG },
      { name: "Planning", status: STATUS.TODO },
      { name: "In Progress", status: STATUS.IN_PROGRESS },
      { name: "Review", status: null }, // Manual-only column, no auto-move
      { name: "Published", status: STATUS.DONE },
    ],
    defaultLabels: [
      { name: "Campaign", color: "#3b82f6" },
      { name: "Content", color: "#a855f7" },
      { name: "Design", color: "#ec4899" },
      { name: "Analytics", color: "#22c55e" },
      { name: "Social", color: "#f97316" },
    ],
  },
  sales: {
    label: "Sales",
    description: "Track leads, deals, and your sales pipeline",
    defaultColumns: [
      { name: "New Leads", status: STATUS.BACKLOG },
      { name: "Contacted", status: STATUS.TODO },
      { name: "Qualified", status: STATUS.IN_PROGRESS },
      { name: "Proposal", status: null }, // Manual-only column, no auto-move
      { name: "Closed Won", status: STATUS.DONE },
    ],
    defaultLabels: [
      { name: "Inbound", color: "#3b82f6" },
      { name: "Outbound", color: "#f97316" },
      { name: "Hot", color: "#ef4444" },
      { name: "Warm", color: "#eab308" },
      { name: "Enterprise", color: "#a855f7" },
      { name: "SMB", color: "#22c55e" },
    ],
  },
};
