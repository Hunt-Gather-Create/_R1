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
  resolveEntityOrFail,
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
  invalidateClientCache,
  PIPELINE_ITEM_FIELDS,
  PIPELINE_ITEM_FIELD_TO_COLUMN,
  findPipelineItemByFuzzyName,
  resolvePipelineItemOrFail,
  CLIENT_FIELDS,
  CLIENT_FIELD_TO_COLUMN,
  TEAM_MEMBER_FIELDS,
  TEAM_MEMBER_FIELD_TO_COLUMN,
  findTeamMemberByFuzzyName,
  resolveTeamMemberOrFail,
  validateAndResolveField,
  containsName,
  replaceResourceName,
  removeFromResources,
  mergeJsonArray,
  setBatchId,
  getBatchId,
  parseResources,
  normalizeResourcesString,
  validateParentProjectIdAssignment,
} from "./operations-utils";

export type {
  FuzzyMatchResult,
  OperationResult,
  ProjectField,
  WeekItemField,
  PipelineItemField,
  ClientField,
  TeamMemberField,
  ResourceEntry,
  ValidatorExecutor,
  ParentProjectIdValidationContext,
  ParentProjectIdValidationResult,
} from "./operations-utils";

// ── Structured mutation response shape (v4 / PR #86) ────
export type {
  MutationResponse,
  MutationSuccess,
  MutationFailure,
  CascadedItemInfo,
  ReverseCascadeInfo,
  UpdateProjectStatusData,
  UpdateProjectFieldData,
  UpdateWeekItemFieldData,
} from "./mutation-response";

// ── Read operations ─────────────────────────────────────
export {
  ENGAGEMENT_TYPE_NULL_SENTINEL,
  PARENT_PROJECT_ID_NULL_SENTINEL,
} from "./operations-reads-clients";
export {
  getClientsWithCounts,
  getClientDetail,
  getProjectsFiltered,
  getLinkedWeekItems,
  getLinkedDeadlineItems,
  getOrphanWeekItems,
  getWeekItemsData,
  getWeekItemsInRange,
  getWeekItemsByProject,
  getPersonWorkload,
  getPipelineData,
  getStaleItemsForAccounts,
} from "./operations-reads";

export type {
  WeekItemRow,
  StaleAccountItem,
  GetClientsWithCountsOptions,
  GetClientDetailOptions,
  ClientDetail,
  ClientDetailProject,
  ClientDetailPipelineItem,
  ClientDetailUpdate,
} from "./operations-reads";

export {
  getRecentUpdates,
  findUpdates,
  getUpdateChain,
} from "./operations-reads-updates";

export type {
  RecentUpdate,
  GetRecentUpdatesParams,
  AuditUpdate,
  FindUpdatesParams,
  UpdateChain,
} from "./operations-reads-updates";

export {
  getProjectStatus,
} from "./operations-reads-project-status";

// ── Flags aggregate surface ─────────────────────────────
export {
  getFlags,
} from "./operations-reads-flags";

export type {
  GetFlagsOptions,
  GetFlagsResult,
} from "./operations-reads-flags";

// ── Health / observability operations ──────────────────
export {
  getDataHealth,
  getCurrentBatch,
  getBatchContents,
  getCascadeLog,
  getRowsChangedSince,
} from "./operations-reads-health";

export type {
  DataHealth,
  DataHealthTotals,
  DataHealthOrphans,
  DataHealthStale,
  DataHealthBatch,
  CurrentBatch,
  BatchContents,
  BatchContentsGroup,
  BatchUpdateEntry,
  CascadeLog,
  CascadeLogGroup,
  CascadeParent,
  CascadeChildEntry,
  ChangedSinceTable,
  GetRowsChangedSinceOptions,
  GetRowsChangedSinceResult,
} from "./operations-reads-health";

export type {
  ProjectStatus,
  ProjectStatusEnum,
  ProjectStatusWeekItem,
  ProjectStatusUpdate,
  EngagementType,
  GetProjectStatusParams,
  GetProjectStatusResult,
} from "./operations-reads-project-status";

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
  GetUpdatesDataOptions,
} from "./operations-context";

// ── Write operations ────────────────────────────────────
export {
  updateProjectStatus,
} from "./operations-writes";

export type {
  UpdateProjectStatusParams,
} from "./operations-writes";

export {
  deleteProject,
  updateProjectField,
} from "./operations-writes-project";

export type {
  DeleteProjectParams,
  UpdateProjectFieldParams,
} from "./operations-writes-project";

export {
  createWeekItem,
  updateWeekItemField,
  deleteWeekItem,
  linkWeekItemToProject,
} from "./operations-writes-week";

export type {
  CreateWeekItemParams,
  UpdateWeekItemFieldParams,
  DeleteWeekItemParams,
  LinkWeekItemToProjectParams,
} from "./operations-writes-week";

export {
  undoLastChange,
} from "./operations-writes-undo";

// ── Team member write operations ───────────────────────
export {
  createTeamMember,
  updateTeamMember,
} from "./operations-writes-team";

export type {
  CreateTeamMemberParams,
  UpdateTeamMemberParams,
} from "./operations-writes-team";

// ── Client write operations ────────────────────────────
export {
  createClient,
  updateClientField,
} from "./operations-writes-client";

export type {
  CreateClientParams,
  UpdateClientFieldParams,
} from "./operations-writes-client";

// ── Pipeline write operations ──────────────────────────
export {
  createPipelineItem,
  updatePipelineItem,
  deletePipelineItem,
} from "./operations-writes-pipeline";

export type {
  CreatePipelineItemParams,
  UpdatePipelineItemParams,
  DeletePipelineItemParams,
} from "./operations-writes-pipeline";

// ── Add operations ──────────────────────────────────────
export {
  addProject,
  addUpdate,
} from "./operations-add";

export type {
  AddProjectParams,
  AddUpdateParams,
} from "./operations-add";
