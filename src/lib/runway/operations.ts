/**
 * Runway Operations — barrel file
 *
 * Single source of truth for all Runway read/write operations.
 * Both the MCP server and Slack bot import from here.
 * Zero DB imports in consumers — all database access goes through this barrel.
 */

// ── Utilities & shared queries ──────────────────────────
export {
  CASCADE_STATUSES,
  TERMINAL_ITEM_STATUSES,
  PROJECT_FIELDS,
  PROJECT_FIELD_TO_COLUMN,
  WEEK_ITEM_FIELDS,
  WEEK_ITEM_FIELD_TO_COLUMN,
  UNDO_FIELDS,
  generateIdempotencyKey,
  generateId,
  clientNotFoundError,
  getClientOrFail,
  matchesSubstring,
  groupBy,
  getAllClients,
  getClientBySlug,
  getClientNameMap,
  findProjectByFuzzyName,
  findProjectByFuzzyNameWithDisambiguation,
  resolveProjectOrFail,
  normalizeForMatch,
  fuzzyMatch,
  fuzzyMatchProject,
  getProjectsForClient,
  checkIdempotency,
  checkDuplicate,
  insertAuditRecord,
  validateField,
  findWeekItemByFuzzyTitle,
  findWeekItemByFuzzyTitleWithDisambiguation,
  resolveWeekItemOrFail,
  fuzzyMatchWeekItem,
  getWeekItemsForWeek,
} from "./operations-utils";

export type { FuzzyMatchResult, ProjectField, WeekItemField } from "./operations-utils";

// ── Read operations ─────────────────────────────────────
export {
  getClientsWithCounts,
  getProjectsFiltered,
  getLinkedWeekItems,
  getWeekItemsData,
  getPersonWorkload,
  getPipelineData,
  getStaleItemsForAccounts,
} from "./operations-reads";

export type {
  WeekItemRow,
  StaleAccountItem,
} from "./operations-reads";

export {
  getRecentUpdates,
} from "./operations-reads-updates";

export type {
  RecentUpdate,
  GetRecentUpdatesParams,
} from "./operations-reads-updates";

// ── Context operations ──────────────────────────────────
export {
  getUpdatesData,
  getTeamMembersData,
  getClientContacts,
  getTeamMemberBySlackId,
  getTeamMemberRecordBySlackId,
} from "./operations-context";

export type {
  TeamMemberRecord,
} from "./operations-context";

// ── Write operations ────────────────────────────────────
export {
  updateProjectStatus,
} from "./operations-writes";

export type {
  UpdateProjectStatusParams,
  OperationResult,
} from "./operations-writes";

export {
  updateProjectField,
} from "./operations-writes-project";

export type {
  UpdateProjectFieldParams,
} from "./operations-writes-project";

export {
  createWeekItem,
  updateWeekItemField,
} from "./operations-writes-week";

export type {
  CreateWeekItemParams,
  UpdateWeekItemFieldParams,
} from "./operations-writes-week";

export {
  undoLastChange,
} from "./operations-writes-undo";

// ── Add operations ──────────────────────────────────────
export {
  addProject,
  addUpdate,
} from "./operations-add";

export type {
  AddProjectParams,
  AddUpdateParams,
} from "./operations-add";
