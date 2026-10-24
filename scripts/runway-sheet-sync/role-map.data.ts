/**
 * The one role map for the RESOURCE column, keyed by client slug. Rule R1
 * as amended 2026-10-24: owner and resources come from here and nowhere else.
 *
 * Ships empty on purpose. Until a client has an entry, every label on its
 * sheets is a counted refusal sent to review, never a silent blank.
 */
import type { RoleMap } from "./role-map";

export const ROLE_MAP: RoleMap = {};
