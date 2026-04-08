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
  getProjectsForClient,
  checkIdempotency,
} from "./operations-utils";

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

// ── Add operations ──────────────────────────────────────
export {
  addProject,
  addUpdate,
} from "./operations-add";

export type {
  AddProjectParams,
  AddUpdateParams,
} from "./operations-add";
