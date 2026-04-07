/**
 * Runway Operations — barrel file
 *
 * Single source of truth for all Runway read/write operations.
 * Both the MCP server and Slack bot import from here.
 * Zero DB imports in consumers — all database access goes through this barrel.
 */

// ── Utilities & shared queries ──────────────────────────
export {
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
  getWeekItemsData,
  getPersonWorkload,
  getPipelineData,
  getStaleItemsForAccounts,
} from "./operations-reads";

export type {
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
