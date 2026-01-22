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
  { name: "Blue", value: "#3b82f6", bg: "bg-blue-500/20", text: "text-blue-400" },
  {
    name: "Purple",
    value: "#a855f7",
    bg: "bg-purple-500/20",
    text: "text-purple-400",
  },
  { name: "Pink", value: "#ec4899", bg: "bg-pink-500/20", text: "text-pink-400" },
  { name: "Gray", value: "#6b7280", bg: "bg-gray-500/20", text: "text-gray-400" },
] as const;

// Keyboard shortcuts
export const SHORTCUTS = {
  COMMAND_PALETTE: "mod+k",
  CREATE_ISSUE: "c",
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
  NONE: "none",
} as const;

export type GroupBy = (typeof GROUP_BY)[keyof typeof GROUP_BY];
