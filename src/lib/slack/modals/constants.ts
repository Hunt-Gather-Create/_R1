/**
 * Slack modal block_id constants.
 *
 * Centralized so the 3 view builders (task / project / team-member) reference
 * the same literal as the validator and interactivity-route block_actions
 * handlers without drift. The validator (validate-submission.ts) and
 * interactivity route still hold the same string literals at their read
 * sites - those validate the runtime contract, and the test fixtures pin
 * them - but new block_ids and renames flow through this file first.
 *
 * Names mirror the underlying string. `as const` preserves literal types
 * so misuse at a TS level is caught at compile time.
 *
 * Civ voice rule: hyphens, not em-dashes. Plain ASCII.
 */

export const BLOCK_IDS = {
  // Shared input blocks (task + project + team-member)
  CLIENT: "client_block",
  CATEGORY: "category_block",
  OWNER: "owner_block",
  RESOURCES: "resources_block",
  NOTES: "notes_block",
  ERROR: "error_block",

  // Task-only
  PARENT_PROJECT: "parent_project_block",
  TITLE: "title_block",
  DATE_TYPE: "date_type_block",
  DATE: "date_block",
  START_DATE: "start_date_block",
  END_DATE: "end_date_block",
  CASCADE_DEADLINE_EXPLAINER: "cascade_deadline_explainer_block",

  // Project-only
  PROJECT_NAME: "project_name_block",
  IS_RETAINER: "is_retainer_block",
  ENGAGEMENT_TYPE: "engagement_type_block",
  PARENT_RETAINER: "parent_retainer_block",
  STATUS: "status_block",
  CONTRACT_START: "contract_start_block",
  CONTRACT_END: "contract_end_block",
  DUE_DATE: "due_date_block",

  // Team-member-only
  NAME: "name_block",
  ROLE_CATEGORY: "role_category_block",

  // Multi-match disambiguation + hint blocks (rendered across kinds)
  MULTI_MATCH_HINT: "multi_match_hint_block",
  MULTI_MATCH_CANDIDATE: "multi_match_candidate_block",
  BASELINE_HINT: "baseline_hint_block",
  TARGET_ENTITY: "target_entity_block",
} as const;
