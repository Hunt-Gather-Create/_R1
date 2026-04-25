# Runway MCP Tools Reference

Authoritative per-tool reference for the Runway MCP server. Every tool registered in `src/lib/mcp/runway-tools.ts` is documented below with its parameters, return shape, an example response, and relevant behavior notes (cascade, flag surfacing, batch tagging).

For a higher-level overview of the Runway system (DB schema, operations layer, bot, Inngest) see [runway.md](./runway.md). For the generic MCP server setup (bearer token wiring, transport, dev flow) see [mcp-integration.md](./mcp-integration.md).

## Purpose

Consumers (Slack bot, Claude Code, Open Brain, ad-hoc LLM clients) call these tools to read from and mutate the Runway Turso database without talking to the schema directly. The MCP layer is a thin formatting wrapper over `src/lib/runway/operations.ts` — the barrel that every DB write must pass through for audit trail, idempotency, fuzzy matching, and cascade handling.

## Auth

All requests to `/api/mcp/runway` require a bearer token in the `Authorization` header:

```
Authorization: Bearer <RUNWAY_MCP_TOKEN>
```

Unauthenticated requests are rejected before tool dispatch.

## Base URL

```
POST /api/mcp/runway
```

The endpoint speaks the MCP JSON-RPC wire format via `WebStandardStreamableHTTPServerTransport`. See `src/app/api/mcp/runway/route.ts` for the transport wiring.

## Tool index

**Reads**

- Clients: [`get_clients`](#get_clients) · [`get_client_detail`](#get_client_detail) · [`get_client_contacts`](#get_client_contacts)
- Projects: [`get_projects`](#get_projects) · [`get_project_status`](#get_project_status)
- Week items (L2): [`get_week_items`](#get_week_items) · [`get_week_items_by_project`](#get_week_items_by_project) · [`get_week_items_range`](#get_week_items_range) · [`get_orphan_week_items`](#get_orphan_week_items) · [`get_person_workload`](#get_person_workload)
- Pipeline: [`get_pipeline`](#get_pipeline)
- Team: [`get_team_members`](#get_team_members)
- Audit / updates: [`get_updates`](#get_updates) · [`find_updates`](#find_updates) · [`get_update_chain`](#get_update_chain)
- Flags + observability: [`get_flags`](#get_flags) · [`get_data_health`](#get_data_health) · [`get_current_batch`](#get_current_batch) · [`get_batch_contents`](#get_batch_contents) · [`get_cascade_log`](#get_cascade_log)

**Writes**

- Projects: [`add_project`](#add_project) · [`delete_project`](#delete_project) · [`update_project_status`](#update_project_status) · [`update_project_field`](#update_project_field)
- Week items: [`create_week_item`](#create_week_item) · [`update_week_item`](#update_week_item) · [`delete_week_item`](#delete_week_item)
- Clients: [`update_client_field`](#update_client_field)
- Pipeline: [`create_pipeline_item`](#create_pipeline_item) · [`update_pipeline_item`](#update_pipeline_item) · [`delete_pipeline_item`](#delete_pipeline_item)
- Team: [`create_team_member`](#create_team_member) · [`update_team_member`](#update_team_member)
- Misc: [`add_update`](#add_update) · [`undo_last_change`](#undo_last_change) · [`set_batch_mode`](#set_batch_mode)

**Appendices**

- [A. v4 response conventions (`MutationResponse<D>`)](#a-v4-response-conventions)
- [B. Bucketing + flags in `get_person_workload`](#b-bucketing--flags-in-get_person_workload)
- [C. Batch mode](#c-batch-mode)
- [D. Cascade model](#d-cascade-model)

---

## Client reads

### `get_clients`

**Description:** List all clients with project counts. Opt in to nested `projects[]` to get the full v4-enriched project rows per client.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `includeProjects` | boolean | no | When true, include each client's nested `projects[]` array. Default `false`. |

**Returns:** `Client[]`. Each client is `{ id, name, slug, contractValue, contractStatus, contractTerm, team, projectCount, updatedAt }`. With `includeProjects=true`, each row also carries a `projects: ProjectRow[]` array using the same shape as [`get_projects`](#get_projects).

**Example response:**

```json
[
  {
    "id": "cli_convergix",
    "name": "Convergix",
    "slug": "convergix",
    "contractValue": "$120k",
    "contractStatus": "signed",
    "contractTerm": "12mo",
    "team": "AM: Kathy / CD: Roz",
    "projectCount": 6,
    "updatedAt": "2026-04-19T17:22:11.000Z"
  }
]
```

**Notes:** Use `includeProjects=false` (the default) for list views — keeps the payload small. Use `true` when the caller is about to drill into multiple clients and wants to avoid N round-trips.

---

### `get_client_detail`

**Description:** Deep view of a single client. Returns the client row plus projects, pipeline items, and the N most recent audit updates.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `slug` | string | yes | Client slug (e.g. `convergix`). |
| `recentUpdatesLimit` | number | no | Cap on `recentUpdates[]`. Default `20`. |

**Returns:** `ClientDetail | errorMessage`. When the slug is unknown, returns a plain text message (`Client '<slug>' not found.`). On success: `{ id, name, slug, nicknames, contractValue, contractTerm, contractStatus, team, clientContacts, createdAt, updatedAt, projects: ClientDetailProject[], pipelineItems: ClientDetailPipelineItem[], recentUpdates: ClientDetailUpdate[] }`.

Each `ClientDetailUpdate` carries `{ id, projectId, updatedBy, updateType, summary, previousValue, newValue, batchId, createdAt }` — use the `id` as input to [`get_update_chain`](#get_update_chain).

**Example response:**

```json
{
  "id": "cli_convergix",
  "name": "Convergix",
  "slug": "convergix",
  "nicknames": null,
  "contractValue": "$120k",
  "contractTerm": "12mo",
  "contractStatus": "signed",
  "team": "AM: Kathy / CD: Roz",
  "clientContacts": "[\"Daniel Garcia\",\"Jill Nguyen\"]",
  "createdAt": "2026-01-06T14:00:00.000Z",
  "updatedAt": "2026-04-19T17:22:11.000Z",
  "projects": [
    {
      "id": "prj_cds_refresh",
      "name": "CDS Refresh",
      "status": "in-production",
      "category": "active",
      "owner": "Kathy",
      "resources": "Roz, Lane",
      "waitingOn": null,
      "notes": null,
      "staleDays": 2,
      "dueDate": "2026-05-15",
      "startDate": "2026-04-01",
      "endDate": "2026-05-15",
      "engagementType": "project",
      "contractStart": null,
      "contractEnd": null,
      "updatedAt": "2026-04-19T17:22:11.000Z"
    }
  ],
  "pipelineItems": [],
  "recentUpdates": [
    {
      "id": "upd_01",
      "projectId": "prj_cds_refresh",
      "updatedBy": "Kathy",
      "updateType": "status-change",
      "summary": "Status: awaiting-client → in-production",
      "previousValue": "awaiting-client",
      "newValue": "in-production",
      "batchId": null,
      "createdAt": "2026-04-19T17:22:11.000Z"
    }
  ]
}
```

**Notes:** Batches projects, pipeline, and updates in a single parallel fan-out. Preferred over calling `get_clients` + `get_projects` + `get_updates` individually when you need everything about one client.

---

### `get_client_contacts`

**Description:** Return parsed client-side contact names for a given client.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |

**Returns:** `{ client: string, contacts: string[] } | errorMessage`. Returns a plain text message when the slug is unknown. `contacts` is parsed from the JSON array stored on `clients.client_contacts`.

**Example response:**

```json
{ "client": "Convergix", "contacts": ["Daniel Garcia", "Jill Nguyen"] }
```

---

## Project reads

### `get_projects`

**Description:** List L1 projects, optionally filtered by client, status, owner, or `waitingOn`.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | no | Filter by client slug. |
| `status` | string | no | Exact status match (e.g. `in-production`, `blocked`, `awaiting-client`). |
| `owner` | string | no | Case-insensitive substring match on `owner`. |
| `waitingOn` | string | no | Case-insensitive substring match on `waitingOn`. |
| `parentProjectId` | string | no | Filter to children of a specific retainer wrapper (pass parent project id). Pass `"__null__"` to match top-level (unparented) projects. |

**Returns:** `ProjectRow[]` — `{ id, name, client, status, category, owner, resources, waitingOn, notes, staleDays, dueDate, startDate, endDate, engagementType, contractStart, contractEnd, updatedAt }`. `client` is resolved to the display name; all date fields are ISO `YYYY-MM-DD`.

**Example response:**

```json
[
  {
    "id": "prj_cds_refresh",
    "name": "CDS Refresh",
    "client": "Convergix",
    "status": "in-production",
    "category": "active",
    "owner": "Kathy",
    "resources": "Roz, Lane",
    "waitingOn": null,
    "notes": null,
    "staleDays": 2,
    "dueDate": "2026-05-15",
    "startDate": "2026-04-01",
    "endDate": "2026-05-15",
    "engagementType": "project",
    "contractStart": null,
    "contractEnd": null,
    "updatedAt": "2026-04-19T17:22:11.000Z"
  }
]
```

**Notes:** Filters are ANDed. `owner` / `waitingOn` are substring (use "Kathy" to match "Kathy / Roz"); `status` is exact.

---

### `get_project_status`

**Description:** Drill down on a single engagement — returns owner, status, engagement type, contract range, blockers, in-flight and upcoming L2s, team, recent updates, and suggested actions.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `projectName` | string | yes | Project name, fuzzy-matched. |

**Returns:** On success, a `ProjectStatus` object: `{ name, client, owner, status, engagement_type, contractRange: { start?, end? }, current: { waitingOn?, blockers? }, inFlight: ProjectStatusWeekItem[], upcoming: ProjectStatusWeekItem[], team, recentUpdates: ProjectStatusUpdate[] (up to 3), suggestedActions: string[] }`. On failure (client not found / project not resolvable), a plain text error message.

`inFlight` = L2s with `status='in-progress'` where today falls in `[startDate, endDate]`. `upcoming` = L2s starting within the next 14 days. `suggestedActions` is a deterministic heuristic (no LLM) that surfaces overdue in-progress items, blocked items, missing `waitingOn`, retainer renewals within 30 days, and "no L2 in flight but project is in-production" nudges.

**Example response:**

```json
{
  "name": "CDS Refresh",
  "client": "Convergix",
  "owner": "Kathy",
  "status": "in-production",
  "engagement_type": "project",
  "contractRange": { "start": "2026-04-01", "end": "2026-05-15" },
  "current": { "waitingOn": null, "blockers": ["Final copy sign-off"] },
  "inFlight": [
    {
      "id": "wi_101",
      "title": "Design review — homepage",
      "status": "in-progress",
      "category": "review",
      "startDate": "2026-04-20",
      "endDate": "2026-04-24",
      "owner": "Roz",
      "resources": "Lane",
      "notes": null,
      "blockedBy": null
    }
  ],
  "upcoming": [],
  "team": "AM: Kathy / CD: Roz",
  "recentUpdates": [
    {
      "id": "upd_42",
      "updateType": "status-change",
      "summary": "Status: awaiting-client → in-production",
      "previousValue": "awaiting-client",
      "newValue": "in-production",
      "updatedBy": "Kathy",
      "createdAt": "2026-04-19T17:22:11.000Z"
    }
  ],
  "suggestedActions": ["unblock \"Final copy sign-off\" (currently blocked)"]
}
```

**Notes:** Time anchor is America/Chicago. Use this for single-project narration; use [`get_person_workload`](#get_person_workload) when the caller asked about a person.

---

## Week item reads

### `get_week_items`

**Description:** Get L2 week items for a specific week (or all weeks). Filter by `owner`, `resource`, or `person` (owner OR resource — preferred for plate queries).

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `weekOf` | string | no | ISO Monday date (e.g. `2026-04-06`). Omit to return all weeks. |
| `owner` | string | no | Case-insensitive substring match on `owner` only. |
| `resource` | string | no | Case-insensitive substring match on `resources` only. |
| `person` | string | no | Substring match against owner OR resources — use for plate queries. |

**Returns:** `WeekItem[]` — `{ id, projectId, clientId, date, dayOfWeek, title, account, category, status, owner, resources, notes, startDate, endDate, blockedBy, updatedAt }`. `account` is the resolved client name (nullable for unlinked L2s).

**Example response:**

```json
[
  {
    "id": "wi_101",
    "projectId": "prj_cds_refresh",
    "clientId": "cli_convergix",
    "date": "2026-04-20",
    "dayOfWeek": "monday",
    "title": "Design review — homepage",
    "account": "Convergix",
    "category": "review",
    "status": "in-progress",
    "owner": "Roz",
    "resources": "Lane",
    "notes": null,
    "startDate": "2026-04-20",
    "endDate": "2026-04-24",
    "blockedBy": null,
    "updatedAt": "2026-04-19T17:22:11.000Z"
  }
]
```

**Notes:** When combining `person` with `owner`/`resource`, all filters apply (AND). `person` is the correct filter for "what's on Kathy's plate" — owner alone misses work she's resourced on.

---

### `get_week_items_by_project`

**Description:** List all non-completed week items under a given project id. Use for drill-down (e.g. "what's left on CDS Refresh?").

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `projectId` | string | yes | L1 project id. |

**Returns:** `WeekItemRow[]` — raw rows from the `week_items` table, sorted by start date (fallback `date`) then `sortOrder`. Completed L2s are filtered out.

**Example response:**

```json
[
  {
    "id": "wi_101",
    "projectId": "prj_cds_refresh",
    "clientId": "cli_convergix",
    "title": "Design review — homepage",
    "status": "in-progress",
    "category": "review",
    "owner": "Roz",
    "resources": "Lane",
    "weekOf": "2026-04-20",
    "date": "2026-04-20",
    "startDate": "2026-04-20",
    "endDate": "2026-04-24",
    "sortOrder": 0,
    "updatedAt": "2026-04-19T17:22:11.000Z"
  }
]
```

**Notes:** Pair with [`get_project_status`](#get_project_status) — `get_project_status` gives the narrative view, this tool gives the raw list of everything that's still open.

---

### `get_week_items_range`

**Description:** List week items whose start date (fallback legacy `date`) falls within `[fromDate, toDate]` inclusive. Filter by client, owner, or category.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `fromDate` | string | yes | Inclusive lower bound, ISO `YYYY-MM-DD`. |
| `toDate` | string | yes | Inclusive upper bound, ISO `YYYY-MM-DD`. |
| `clientSlug` | string | no | Narrow to one client. |
| `owner` | string | no | Case-insensitive substring match on owner. |
| `category` | string | no | Exact category match — one of `delivery`, `review`, `kickoff`, `deadline`, `approval`, `launch`. |

**Returns:** `WeekItemRow[]` — raw rows ordered by `date` asc then `sortOrder`.

**Example response:**

```json
[
  {
    "id": "wi_205",
    "projectId": "prj_cds_refresh",
    "clientId": "cli_convergix",
    "title": "Homepage launch",
    "status": "not-started",
    "category": "launch",
    "owner": "Kathy",
    "startDate": "2026-05-10",
    "endDate": "2026-05-10"
  }
]
```

**Notes:** Use this (not [`get_week_items`](#get_week_items)) when the caller asks about a date window that spans multiple weeks.

---

### `get_orphan_week_items`

**Description:** List week items whose `projectId` is null — L2s that drifted off their parent L1 (often during imports or cascades).

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | no | Narrow to orphans belonging to a single client. |

**Returns:** `WeekItemRow[]` — raw `week_items` rows with `projectId === null`.

**Example response:**

```json
[
  {
    "id": "wi_555",
    "projectId": null,
    "clientId": "cli_bonterra",
    "title": "Stub — pending client confirmation",
    "status": "not-started",
    "owner": "Kathy"
  }
]
```

**Notes:** Useful before/after cleanup batches. Pair with [`get_data_health`](#get_data_health) for a snapshot count.

---

### `get_person_workload`

**Description:** Get a person's workload bucketed per the v4 convention. The most-used tool for "what's on X's plate" queries — see [Appendix B](#b-bucketing--flags-in-get_person_workload) for the full bucketing semantics.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `personName` | string | yes | Person's name (e.g. `Kathy`, `Roz`). Substring match. |

**Returns:** `PersonWorkload`:

```
{
  person: string,
  ownedProjects: {
    inProgress: ProjectRow[],
    awaitingClient: ProjectRow[],
    blocked: ProjectRow[],
    onHold: ProjectRow[],
    completed: ProjectRow[]   // empty unless includeCompleted was set by a direct caller
  },
  weekItems: {
    overdue: WeekItemRow[],
    thisWeek: WeekItemRow[],
    nextWeek: WeekItemRow[],
    later: WeekItemRow[]
  },
  flags: {
    contractExpired: ClientRow[],
    retainerRenewalDue: ProjectRow[]
  },
  totalProjects: number,         // excludes completed unless includeCompleted
  totalActiveWeekItems: number
}
```

L1 `ownedProjects` surfaces only projects where this person is the owner. L2 `weekItems` surfaces items where this person is the owner OR a resource. Stub L2s (whose parent L1 has `status='awaiting-client'`) are filtered out of active buckets.

**Example response:**

```json
{
  "person": "Kathy",
  "ownedProjects": {
    "inProgress": [{ "id": "prj_cds_refresh", "name": "CDS Refresh", "status": "in-production" }],
    "awaitingClient": [],
    "blocked": [],
    "onHold": [],
    "completed": []
  },
  "weekItems": {
    "overdue": [],
    "thisWeek": [{ "id": "wi_101", "title": "Design review — homepage" }],
    "nextWeek": [],
    "later": []
  },
  "flags": {
    "contractExpired": [],
    "retainerRenewalDue": []
  },
  "totalProjects": 1,
  "totalActiveWeekItems": 1
}
```

**Notes:** Date buckets are anchored to America/Chicago. Present the L2 buckets first in the response, roll up the L1 count at the end, and surface `flags` prominently — they're soft blockers the human needs to see.

---

## Pipeline reads

### `get_pipeline`

**Description:** List all pipeline items (unsigned SOWs, new business opportunities).

**Params:** None.

**Returns:** `PipelineItem[]` — `{ account, name, status, estimatedValue, waitingOn, notes }`. `account` is the resolved client name (nullable).

**Example response:**

```json
[
  {
    "account": "Convergix",
    "name": "Phase 2 retainer",
    "status": "drafting",
    "estimatedValue": "$45k",
    "waitingOn": "Daniel",
    "notes": null
  }
]
```

---

## Team reads

### `get_team_members`

**Description:** List active team members, roles, and accounts they lead.

**Params:** None.

**Returns:** `TeamMember[]` — `{ name, firstName, title, roleCategory, accountsLed: string[], channelPurpose }`. `accountsLed` is parsed from the stored JSON array.

**Example response:**

```json
[
  {
    "name": "Kathy",
    "firstName": "Kathy",
    "title": "Account Director",
    "roleCategory": "am",
    "accountsLed": ["convergix", "bonterra"],
    "channelPurpose": null
  }
]
```

**Notes:** Only returns rows where `is_active=1`.

---

## Audit / update reads

### `get_updates`

**Description:** Recent update history, tuned for bot-style activity feeds. Returns a minimal row shape — use [`find_updates`](#find_updates) when you need audit ids or `triggeredByUpdateId`.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | no | Filter by client slug. |
| `limit` | number | no | Max rows. Default `20`. |
| `since` | string | no | ISO lower bound on `createdAt` (inclusive). |
| `until` | string | no | ISO upper bound on `createdAt` (inclusive). |
| `batchId` | string | no | Exact match on `updates.batch_id`. |
| `updateType` | string | no | Exact match — e.g. `status-change`, `field-change`, `cascade-status-change`, `cascade-date-change`. |
| `projectName` | string | no | Case-insensitive substring match against the linked project's name. |

**Returns:** `RecentUpdate[]` — `{ clientName, projectName, updatedBy, updateType, summary, previousValue, newValue, createdAt }`. Rows ordered newest-first.

**Example response:**

```json
[
  {
    "clientName": "Convergix",
    "projectName": "CDS Refresh",
    "updatedBy": "Kathy",
    "updateType": "status-change",
    "summary": "Status: awaiting-client → in-production",
    "previousValue": "awaiting-client",
    "newValue": "in-production",
    "createdAt": "2026-04-19T17:22:11.000Z"
  }
]
```

**Notes:** Defaults to the last 7 days when `since` is not provided. The result omits `id`, `batchId`, and `triggeredByUpdateId` — reach for [`find_updates`](#find_updates) if you need any of those.

---

### `find_updates`

**Description:** Full audit-trail search over the `updates` table. Returns `AuditUpdate[]` with `id` and `triggeredByUpdateId` so callers can follow cascades.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `since` | string | no | Inclusive ISO lower bound on `createdAt`. |
| `until` | string | no | Inclusive ISO upper bound on `createdAt`. |
| `clientSlug` | string | no | Narrow to one client. |
| `updatedBy` | string | no | Case-insensitive substring match on `updates.updated_by`. |
| `updateType` | string | no | Exact match. |
| `batchId` | string | no | Exact match on `updates.batch_id`. |
| `projectName` | string | no | Case-insensitive substring match against the linked project's name. |
| `limit` | number | no | Hard cap. Default `100`. |

**Returns:** `AuditUpdate[]` — `{ id, clientName, projectName, updatedBy, updateType, summary, previousValue, newValue, batchId, triggeredByUpdateId, createdAt }`. Rows ordered newest-first.

**Example response:**

```json
[
  {
    "id": "upd_cas_02",
    "clientName": "Convergix",
    "projectName": "CDS Refresh",
    "updatedBy": "mcp",
    "updateType": "cascade-status-change",
    "summary": "Cascaded status=completed to 'Design review — homepage'",
    "previousValue": "in-progress",
    "newValue": "completed",
    "batchId": null,
    "triggeredByUpdateId": "upd_cas_01",
    "createdAt": "2026-04-19T17:22:12.000Z"
  }
]
```

**Notes:** Use this — not [`get_updates`](#get_updates) — when you plan to call [`get_update_chain`](#get_update_chain) next. The `id` and `triggeredByUpdateId` fields are only on `AuditUpdate`.

---

### `get_update_chain`

**Description:** Walk the cascade audit linkage for a given update id. Returns the root ancestor and every descendant ordered by `createdAt` ascending.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `updateId` | string | yes | `updates.id` to follow. Typically obtained from [`find_updates`](#find_updates) or a mutation response's `data.auditId`. |

**Returns:** `{ root: AuditUpdate | null, chain: AuditUpdate[] }`. Missing id or broken chain returns `{ root: null, chain: [] }`.

**Example response:**

```json
{
  "root": {
    "id": "upd_cas_01",
    "clientName": "Convergix",
    "projectName": "CDS Refresh",
    "updateType": "status-change",
    "summary": "Status: in-production → completed",
    "triggeredByUpdateId": null,
    "createdAt": "2026-04-19T17:22:11.000Z"
  },
  "chain": [
    { "id": "upd_cas_01", "updateType": "status-change", "triggeredByUpdateId": null },
    { "id": "upd_cas_02", "updateType": "cascade-status-change", "triggeredByUpdateId": "upd_cas_01" },
    { "id": "upd_cas_03", "updateType": "cascade-status-change", "triggeredByUpdateId": "upd_cas_01" }
  ]
}
```

**Notes:** See [Appendix D](#d-cascade-model) for the cascade model overview.

---

## Flags + observability

### `get_flags`

**Description:** Aggregate surface for every soft flag the board and bot raise — past-end L2s, stale L1s, `waitingOn` bottlenecks, today/tomorrow deadlines, resource conflicts, retainer renewals, expired contracts.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | no | Narrow to one client. |
| `personName` | string | no | Narrow to flags where owner or `waitingOn` matches (substring). |

**Returns:** `{ flags: RunwayFlag[], retainerRenewalDue: RetainerRenewalPill[], contractExpired: ContractExpiredPill[] }`.

- `RunwayFlag = { id, type, severity, title, detail, relatedClient?, relatedPerson? }`
  - `type` is one of `resource-conflict`, `stale`, `deadline`, `bottleneck`, `past-end-l2`.
  - `severity` is `critical | warning | info`.
- `RetainerRenewalPill = { projectName, contractEnd, daysOut }`
- `ContractExpiredPill = { clientName }`

**Example response:**

```json
{
  "flags": [
    {
      "id": "past-end-wi_101",
      "type": "past-end-l2",
      "severity": "warning",
      "title": "Past end date",
      "detail": "Design review — homepage is still in-progress past its end date (2026-04-24)",
      "relatedClient": "Convergix",
      "relatedPerson": "Roz"
    }
  ],
  "retainerRenewalDue": [
    { "projectName": "Bonterra Always-On", "contractEnd": "2026-05-10", "daysOut": 20 }
  ],
  "contractExpired": []
}
```

**Notes:** Mirrors the UI board's `analyzeFlags()` output — same severity ordering (critical → warning → info).

---

### `get_data_health`

**Description:** DB health snapshot — totals, orphan counts, staleness signals, batch state, most-recent update timestamp.

**Params:** None.

**Returns:** `DataHealth`:

```
{
  totals: { projects, weekItems, clients, updates, pipelineItems },
  orphans: {
    weekItemsWithoutProject,           // L2s with null projectId
    projectsWithoutClient,             // should be 0 (schema notNull)
    updatesWithDanglingTriggeredBy     // triggeredByUpdateId pointing at a missing row
  },
  stale: {
    staleProjects,  // staleDays >= 14, excluding completed/on-hold
    pastEndL2s      // in-progress L2s past end/start date
  },
  batch: {
    activeBatchId,              // current in-process batch id, or null
    distinctBatchIdsLast7Days   // count of distinct batch_ids in updates over last 7 days
  },
  lastUpdateAt
}
```

**Example response:**

```json
{
  "totals": { "projects": 82, "weekItems": 410, "clients": 13, "updates": 1903, "pipelineItems": 7 },
  "orphans": { "weekItemsWithoutProject": 3, "projectsWithoutClient": 0, "updatesWithDanglingTriggeredBy": 0 },
  "stale": { "staleProjects": 4, "pastEndL2s": 2 },
  "batch": { "activeBatchId": null, "distinctBatchIdsLast7Days": 5 },
  "lastUpdateAt": "2026-04-19T17:22:12.000Z"
}
```

**Notes:** Call before and after cleanup batches to measure drift.

---

### `get_current_batch`

**Description:** Return the currently-active batch for the calling process. Batch state is module-memory, not DB-persisted — so this reflects the current request's scope.

**Params:** None.

**Returns:** `CurrentBatch` — `{ active: false }` or `{ active: true, batchId, itemCount, startedAt, startedBy, mostRecentAt }`. `itemCount` is the number of audit rows already tagged; `startedBy` is the `updatedBy` of the earliest row.

**Example response:**

```json
{
  "active": true,
  "batchId": "cleanup-2026-04-19",
  "itemCount": 12,
  "startedAt": "2026-04-19T17:15:00.000Z",
  "startedBy": "mcp",
  "mostRecentAt": "2026-04-19T17:21:02.000Z"
}
```

**Notes:** See [Appendix C](#c-batch-mode). If you're running a migration script, check this at the top to confirm the batch is wired before any writes.

---

### `get_batch_contents`

**Description:** Retrieve every audit row tagged with a given `batchId`, grouped by `(client, project)` and sorted within each group by `createdAt` ascending.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `batchId` | string | yes | Batch id to inspect. |

**Returns:** `BatchContents`:

```
{
  batchId: string,
  totalUpdates: number,
  groups: [
    {
      clientName: string | null,
      projectName: string | null,
      updates: BatchUpdateEntry[]   // { id, clientName, projectName, updateType, summary, updatedBy, createdAt }
    }
  ]
}
```

**Example response:**

```json
{
  "batchId": "cleanup-2026-04-19",
  "totalUpdates": 12,
  "groups": [
    {
      "clientName": "Convergix",
      "projectName": "CDS Refresh",
      "updates": [
        {
          "id": "upd_a",
          "clientName": "Convergix",
          "projectName": "CDS Refresh",
          "updateType": "field-change",
          "summary": "dueDate updated",
          "updatedBy": "mcp",
          "createdAt": "2026-04-19T17:15:11.000Z"
        }
      ]
    }
  ]
}
```

**Notes:** Use to review what a batch did before running `scripts/runway-publish-updates.ts` to post to Slack.

---

### `get_cascade_log`

**Description:** Recent cascade-generated audit rows within a time window, grouped by parent update id.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `windowMinutes` | number | no | Look-back window in minutes. Default `60`. |

**Returns:** `CascadeLog`:

```
{
  windowMinutes: number,
  since: Date,
  totalCascadeRows: number,
  groups: [
    {
      parentUpdateId: string | null,
      parent: CascadeParent | null,     // resolved parent row, or null when dangling
      children: CascadeChildEntry[]     // cascade-* rows ordered by createdAt asc
    }
  ]
}
```

Groups are ordered by most-recent child `createdAt` descending. Children are filtered to `updateType` starting with `cascade-`.

**Example response:**

```json
{
  "windowMinutes": 60,
  "since": "2026-04-19T16:22:12.000Z",
  "totalCascadeRows": 3,
  "groups": [
    {
      "parentUpdateId": "upd_cas_01",
      "parent": {
        "id": "upd_cas_01",
        "updateType": "status-change",
        "summary": "Status: in-production → completed",
        "clientName": "Convergix",
        "projectName": "CDS Refresh",
        "createdAt": "2026-04-19T17:22:11.000Z"
      },
      "children": [
        {
          "id": "upd_cas_02",
          "updateType": "cascade-status-change",
          "summary": "Cascaded status=completed to 'Design review — homepage'",
          "clientName": "Convergix",
          "projectName": "CDS Refresh",
          "createdAt": "2026-04-19T17:22:12.000Z"
        }
      ]
    }
  ]
}
```

**Notes:** Pair with [`get_update_chain`](#get_update_chain) to walk a specific chain.

---

## Writes — projects

All write tools follow the v4 `MutationResponse<D>` shape — see [Appendix A](#a-v4-response-conventions). Successful mutations with a `data` payload return a JSON-wrapped `{ message, data }` text response; successful mutations without structured data return a plain text message; failures always return the raw error text.

### `add_project`

**Description:** Create a new project under a client.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `name` | string | yes | Project name. |
| `status` | string | no | Default `not-started`. |
| `category` | string | no | Default `active`. |
| `owner` | string | no | Owner name. |
| `notes` | string | no | Freeform notes. |
| `updatedBy` | string | no | Person adding the project. Default `mcp`. |

**Returns:** Plain text success message, or error text if the client slug is unknown / a duplicate is detected.

**Example response:**

```
Added project 'Phase 2 discovery' under Convergix.
```

**Notes:** Duplicate detection compares against existing projects on the same client.

---

### `delete_project`

**Description:** Delete a project from a client.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `projectName` | string | yes | Project name, fuzzy-matched. |
| `updatedBy` | string | no | Person making the update. Default `mcp`. |

**Returns:** Plain text success message, or error text with `available[]` when the project can't be resolved.

**Example response:**

```
Deleted project 'Phase 2 discovery' from Convergix.
```

**Notes:** FK deletion cascade: see `docs/runway-fk-deletion-pattern.md` for how linked week items and audit rows are handled.

---

### `update_project_status`

**Description:** Change a project's status and log the update. Status changes to terminal statuses (`completed`, `canceled`, `on-hold`) cascade to linked L2 week items.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `projectName` | string | yes | Project name, fuzzy-matched. |
| `newStatus` | string | yes | New status value. |
| `updatedBy` | string | no | Default `mcp`. |
| `notes` | string | no | Additional context logged on the audit row. |

**Returns:** JSON-wrapped `{ message, data: UpdateProjectStatusData }`. `data` = `{ clientName, projectName, previousStatus, newStatus, cascadedItems: string[], cascadeDetail: CascadedItemInfo[], auditId? }`. `cascadedItems` is the legacy title-only list; `cascadeDetail` is the v4 per-item trace.

**Example response:**

```json
{
  "message": "Updated Convergix CDS Refresh status: in-production → completed (cascaded 2 item(s))",
  "data": {
    "clientName": "Convergix",
    "projectName": "CDS Refresh",
    "previousStatus": "in-production",
    "newStatus": "completed",
    "cascadedItems": ["Design review — homepage", "Final copy sign-off"],
    "cascadeDetail": [
      {
        "itemId": "wi_101",
        "itemTitle": "Design review — homepage",
        "field": "status",
        "previousValue": "in-progress",
        "newValue": "completed",
        "auditId": "upd_cas_02"
      },
      {
        "itemId": "wi_102",
        "itemTitle": "Final copy sign-off",
        "field": "status",
        "previousValue": "blocked",
        "newValue": "completed",
        "auditId": "upd_cas_03"
      }
    ],
    "auditId": "upd_cas_01"
  }
}
```

**Notes:** Posts a Slack notification to the updates channel when not in batch mode (see [Appendix C](#c-batch-mode)). To follow the cascade chain, pass `data.auditId` to [`get_update_chain`](#get_update_chain).

---

### `update_project_field`

**Description:** Update a specific field on a project. When `field='dueDate'`, the change cascades to linked L2 week items.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `projectName` | string | yes | Project name, fuzzy-matched. |
| `field` | enum | yes | One of `name`, `dueDate`, `owner`, `resources`, `waitingOn`, `notes`, `parentProjectId`, `engagementType`, `contractStart`, `contractEnd`. |
| `newValue` | string | yes | New value. Pass empty string to clear `parentProjectId` / `engagementType` / `contractStart` / `contractEnd`. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** JSON-wrapped `{ message, data: UpdateProjectFieldData }`. `data` = `{ clientName, projectName, field, previousValue, newValue, cascadedItems, cascadeDetail, auditId? }`. `cascadeDetail` is empty unless `field === 'dueDate'`.

**Tool-boundary validation:** `engagementType` must be `retainer` or `project` (or `''` to clear). `contractStart` / `contractEnd` must be ISO `YYYY-MM-DD` (real parse + roundtrip; rejects e.g. `2026-13-45`).

**Helper-level invariants:** `parentProjectId` runs the shared `validateParentProjectIdAssignment` (parent exists, parent is `engagementType='retainer'`, same `client_id`, no cycle via 10-hop walk). `contractStart` / `contractEnd` enforce `start < end` against the project's current OTHER value when both are non-null; null other side or empty-string clear skips the check.

**Example response:**

```json
{
  "message": "Updated Convergix CDS Refresh dueDate: 2026-05-15 → 2026-05-22 (cascaded 1 item)",
  "data": {
    "clientName": "Convergix",
    "projectName": "CDS Refresh",
    "field": "dueDate",
    "previousValue": "2026-05-15",
    "newValue": "2026-05-22",
    "cascadedItems": ["Homepage launch"],
    "cascadeDetail": [
      {
        "itemId": "wi_205",
        "itemTitle": "Homepage launch",
        "field": "date",
        "previousValue": "2026-05-15",
        "newValue": "2026-05-22",
        "auditId": "upd_cas_22"
      }
    ],
    "auditId": "upd_cas_21"
  }
}
```

---

## Writes — week items

### `create_week_item`

**Description:** Add a new item to the weekly calendar.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Week item title. |
| `clientSlug` | string | no | Client slug (if related to a client). |
| `projectName` | string | no | Project name, fuzzy-matched. |
| `weekOf` | string | no | ISO Monday date; auto-calculated from `date` if omitted. |
| `date` | string | no | Exact ISO date. |
| `dayOfWeek` | string | no | e.g. `tuesday`. |
| `status` | string | no | Initial status. |
| `category` | string | no | `delivery`, `review`, `kickoff`, `deadline`, `approval`, `launch`. |
| `owner` | string | no | Owner name. |
| `resources` | string | no | Resources string. |
| `notes` | string | no | Freeform notes. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** Plain text success message, or error text.

**Example response:**

```
Added week item 'Homepage launch' for Convergix on 2026-05-22.
```

---

### `update_week_item`

**Description:** Update a field on an existing week item. When the item is a `deadline`-category L2 and `field='date'`, the change reverse-cascades to the parent project's `dueDate`.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `weekOf` | string | yes | ISO Monday date. |
| `weekItemTitle` | string | yes | Week item title, fuzzy-matched. |
| `field` | enum | yes | One of `title`, `status`, `date`, `dayOfWeek`, `owner`, `resources`, `notes`, `category`. |
| `newValue` | string | yes | New value. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** JSON-wrapped `{ message, data: UpdateWeekItemFieldData }`. `data` = `{ weekItemTitle, field, previousValue, newValue, clientName?, reverseCascaded, reverseCascadeDetail, auditId? }`.

`reverseCascadeDetail` is non-null only when the change was a deadline L2 date change that back-propagated to the parent project's `dueDate`:

```
{
  projectId: string,
  projectName: string,
  field: 'dueDate',
  previousDueDate: string | null,
  newDueDate: string,
  auditId: string
}
```

**Example response (reverse cascade fired):**

```json
{
  "message": "Updated week item 'Homepage launch' date: 2026-05-15 → 2026-05-22 (reverse-cascaded to CDS Refresh dueDate)",
  "data": {
    "weekItemTitle": "Homepage launch",
    "field": "date",
    "previousValue": "2026-05-15",
    "newValue": "2026-05-22",
    "clientName": "Convergix",
    "reverseCascaded": true,
    "reverseCascadeDetail": {
      "projectId": "prj_cds_refresh",
      "projectName": "CDS Refresh",
      "field": "dueDate",
      "previousDueDate": "2026-05-15",
      "newDueDate": "2026-05-22",
      "auditId": "upd_rev_01"
    },
    "auditId": "upd_rev_01"
  }
}
```

---

### `delete_week_item`

**Description:** Remove a week item from the calendar. Locate the item either by `weekOf + weekItemTitle` (fuzzy) or by `id`.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `weekOf` | string | no | ISO Monday date. |
| `weekItemTitle` | string | no | Week item title, fuzzy-matched. |
| `id` | string | no | Direct week item id. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** Plain text success message, or error text with `available[]` when the title can't be resolved.

**Example response:**

```
Deleted week item 'Homepage launch'.
```

**Notes:** When `id` is provided, `weekOf` / `weekItemTitle` are ignored.

---

## Writes — clients

### `update_client_field`

**Description:** Update a field on a client record.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `field` | enum | yes | One of `name`, `team`, `contractValue`, `contractTerm`, `contractStatus`, `clientContacts`, `nicknames`. |
| `newValue` | string | yes | New value. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** Plain text success message, or error text.

**Example response:**

```
Updated Convergix team: AM: Kathy → AM: Kathy / CD: Roz.
```

**Notes:** There is no `create_client` MCP tool — adding clients is not surfaced through MCP today. Use a migration script if you need to create one.

---

## Writes — pipeline

### `create_pipeline_item`

**Description:** Create a new pipeline item (SOW, new business opportunity).

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `name` | string | yes | Pipeline item name. |
| `owner` | string | no | Owner name. |
| `status` | string | no | `scoping`, `drafting`, `sow-sent`, `verbal`, `signed`, `at-risk`. |
| `estimatedValue` | string | no | Free-form value (e.g. `$45k`). |
| `waitingOn` | string | no | Person the item is waiting on. |
| `notes` | string | no | Freeform notes. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** Plain text success message, or error text.

**Example response:**

```
Added pipeline item 'Phase 2 retainer' under Convergix.
```

---

### `update_pipeline_item`

**Description:** Update a field on a pipeline item.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `pipelineName` | string | yes | Pipeline item name, fuzzy-matched. |
| `field` | enum | yes | One of `name`, `owner`, `status`, `estimatedValue`, `waitingOn`, `notes`. |
| `newValue` | string | yes | New value. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** Plain text success message, or error text.

**Example response:**

```
Updated Convergix pipeline item 'Phase 2 retainer' status: drafting → sow-sent.
```

---

### `delete_pipeline_item`

**Description:** Remove a pipeline item.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `pipelineName` | string | yes | Pipeline item name, fuzzy-matched. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** Plain text success message, or error text.

**Example response:**

```
Removed pipeline item 'Phase 2 retainer' from Convergix.
```

---

## Writes — team

### `create_team_member`

**Description:** Add a new team member.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Short name (e.g. `Lane`). |
| `firstName` | string | no | First name. |
| `fullName` | string | no | Full name (e.g. `Lane Davis`). |
| `title` | string | no | Job title. |
| `roleCategory` | string | no | `am`, `pm`, `creative`, `dev`. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** Plain text success message, or error text.

**Example response:**

```
Added team member 'Lane'.
```

---

### `update_team_member`

**Description:** Update a field on a team member.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `memberName` | string | yes | Team member name, fuzzy-matched. |
| `field` | enum | yes | One of `title`, `fullName`, `slackUserId`, `roleCategory`, `accountsLed`, `isActive`, `nicknames`, `channelPurpose`. |
| `newValue` | string | yes | New value. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** Plain text success message, or error text.

**Example response:**

```
Updated Lane roleCategory: creative → dev.
```

**Notes:** `accountsLed` accepts a JSON-encoded array string — e.g. `["convergix","bonterra"]`.

---

## Writes — misc

### `add_update`

**Description:** Log a free-form update for a client or project (no structured change — just narrative).

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `projectName` | string | no | Project name, fuzzy-matched. |
| `summary` | string | yes | The update text. |
| `updatedBy` | string | no | Default `mcp`. |

**Returns:** Plain text success message, or error text.

**Example response:**

```
Logged update for Convergix CDS Refresh.
```

**Notes:** Posts to the Slack updates channel when not in batch mode.

---

### `undo_last_change`

**Description:** Undo the most recent change written by the calling process.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `updatedBy` | string | no | Person who made the change to undo. Default `mcp`. |

**Returns:** Plain text success message, or error text if nothing undo-able is on the stack.

**Example response:**

```
Reverted last change: Convergix CDS Refresh status → in-production.
```

**Notes:** Undo scope is narrow — see `operations-writes-undo.ts` for which fields are reversible.

---

### `set_batch_mode`

**Description:** Enable or disable batch mode. When active, Slack notifications are suppressed and audit records are tagged with the `batchId`.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `batchId` | string \| null | yes | Batch id to set, or `null` to clear. |

**Returns:** Plain text confirmation — `Batch mode enabled: <batchId>` or `Batch mode disabled`.

**Notes:** See [Appendix C](#c-batch-mode) for the full batch model.

---

## Writes — overrides + batch dispatch

### `override_project_date`

**Description:** Force-write `project.start_date` or `project.end_date` past the `PROJECT_FIELDS` whitelist. Audit row uses `update_type='date-override'` with both old and new values; idempotency key includes `oldValue` so revert + retry doesn't poison the key. On retainer wrappers (`engagementType='retainer'` plus at least one L1 child pointing at the project), `bypassGuard=true` is required or the call rejects.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug. |
| `projectName` | string | yes | Project name (fuzzy match). |
| `field` | `'startDate' \| 'endDate'` | yes | Which derived date column to override. |
| `newValue` | string \| null | yes | ISO `YYYY-MM-DD` or null (clears). |
| `updatedBy` | string | no (default `mcp`) | Person making the override. |
| `bypassGuard` | boolean | no | Required `true` to override on a retainer wrapper L1. |

**Returns:** `MutationResponse<{ clientName, projectName, field, previousValue, newValue, auditId }>`. Failure cases: project not found, retainer wrapper without bypass, shape-invalid date.

**Notes:** Use this when an L1 needs a non-derived start/end date — typically retainer wrappers (with `bypassGuard`) or one-off rollups where the derived MIN/MAX isn't right. Recompute (`recomputeProjectDatesWith`) does not run; the value persists exactly as written.

---

### `set_project_parent`

**Description:** Attach an L1 project to a retainer wrapper, or clear the link. Resolves the parent by name within the same client and routes through `update_project_field`, which calls `validateParentProjectIdAssignment` (parent exists, parent is `engagementType='retainer'`, same `client_id`, no cycle via 10-hop walk).

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `clientSlug` | string | yes | Client slug (parent and child must share). |
| `projectName` | string | yes | Child project name (fuzzy match). |
| `parentProjectName` | string \| null | yes | Wrapper project name in the same client; `null` clears the link. |
| `updatedBy` | string | no (default `mcp`) | Person making the change. |

**Returns:** `MutationResponse<UpdateProjectFieldData>` — same shape as `update_project_field`.

**Notes:** Defense-in-depth — both the tool resolves + validates, and `update_project_field` revalidates via the shared validator module. A direct `update_project_field({ field: 'parentProjectId' })` call goes through the same checks.

---

### `batch_apply`

**Description:** Apply a sequence of mutation tools under a single `batch_id`. Audit rows are tagged with the `batchId`; Slack updates are suppressed for the batch. Ops execute sequentially to preserve audit ordering. Per-op `MutationResponse`s are captured into `results[]`. `haltOnError` defaults `true` (abort on first failure); pass `false` to run every op regardless of failures. Recursive `batch_apply` is not allowed.

**Params:**
| Name | Type | Required | Description |
|---|---|---|---|
| `batchId` | string | yes | Unique batch identifier (e.g. `wrapper-rebalance-2026-04-25`). |
| `updatedBy` | string | yes | Default `updatedBy` applied to every op (per-op `args.updatedBy` overrides). |
| `ops` | `Array<{ tool, args }>` | yes | Sequence of operations. |
| `haltOnError` | boolean | no (default `true`) | Abort on first failure. |

**Dispatchable tools:** `update_project_field`, `update_project_status`, `add_project`, `delete_project`, `create_week_item`, `update_week_item`, `delete_week_item`, `override_project_date`, `set_project_parent`. Other read tools, `set_batch_mode`, `add_update`, `undo_last_change`, and `batch_apply` itself are excluded.

**Returns:** Always returns the structured payload `{ ok, message, data: { results } }`. Each `results[i]` carries `{ tool, ok, message?, error?, data? }`. `ok` at the top level is `true` only when every op succeeded.

**Notes:** `setBatchId(batchId)` runs at entry; `setBatchId(null)` runs in `finally` (cleared even when a handler throws). Exceptions inside an op handler are caught and recorded as `{ ok: false, error: <message> }` for that op. Tool-boundary format validation (the engagement/ISO checks at MCP entry) does NOT run for batch-dispatched ops; helpers enforce semantic invariants (parentProjectId validators, contract-date invariant, recompute guard).

---

## A. v4 response conventions

Every Runway mutation function returns a typed `MutationResponse<D>` (see `src/lib/runway/mutation-response.ts`). The wire format sent back to MCP callers depends on whether the success branch carries a structured `data` payload.

**Success, no `data`:**

```
<plain text message>
```

**Success, with `data`:** JSON text containing the message and the typed payload.

```json
{
  "message": "<human-readable message>",
  "data": { /* typed per-mutation fields */ }
}
```

**Failure:** Plain text error body — `result.error`. No JSON wrapping.

Callers should attempt `JSON.parse` on the response body when they expect a `data` payload. If parsing fails, fall back to treating the body as a plain message.

**Which mutations carry `data`?**

| Tool | `data` type | Notable fields |
|---|---|---|
| `update_project_status` | `UpdateProjectStatusData` | `cascadedItems`, `cascadeDetail`, `auditId` |
| `update_project_field` | `UpdateProjectFieldData` | `cascadeDetail` (only when `field='dueDate'`), `auditId` |
| `update_week_item` | `UpdateWeekItemFieldData` | `reverseCascaded`, `reverseCascadeDetail`, `auditId` |

All other mutations (`add_project`, `delete_project`, `create_week_item`, `delete_week_item`, pipeline writes, client writes, team writes, `add_update`, `undo_last_change`, `set_batch_mode`) return plain text.

`cascadeDetail` and `reverseCascadeDetail` are the v4 additions introduced in PR #86. They give callers the per-item audit-row id (`auditId`) so a cascade chain can be walked with [`get_update_chain`](#get_update_chain) without re-querying. The legacy `cascadedItems: string[]` and `reverseCascaded: boolean` fields are preserved verbatim for backward compatibility.

## B. Bucketing + flags in `get_person_workload`

`get_person_workload` is the most-called tool — worth reading once so responses are interpreted correctly.

**Match rules:**

- **L1 (owned projects):** person appears in `projects.owner` (substring match). Resources do not surface L1s — "owned" means accountable.
- **L2 (week items):** person appears in `owner` OR `resources`.

**Project buckets (`ownedProjects`):** keyed on `projects.status`:

- `awaiting-client` → `awaitingClient`
- `blocked` → `blocked`
- `on-hold` → `onHold`
- `completed` → `completed` (empty unless the internal `includeCompleted` flag is set — not exposed through MCP)
- everything else (including `in-production`, `not-started`, `null`) → `inProgress`

**Week item buckets (`weekItems`):** anchored to America/Chicago today:

- `overdue` — `(endDate ?? startDate) < today` AND `status !== 'completed'`
- `thisWeek` — `startDate` in `[thisMonday, thisSunday]`, or item spans into this week
- `nextWeek` — `startDate` in `[nextMonday, nextSunday]`
- `later` — `startDate` beyond next Sunday
- Completed L2s are excluded from all forward buckets to prevent future-dated completions from inflating counts.

**Stub filter:** L2s whose parent L1 has `status='awaiting-client'` are filtered out of all buckets — they're "stubs" that shouldn't surface as active work.

**Flags:** two soft flags ride alongside the buckets:

- `flags.contractExpired: ClientRow[]` — clients with `contractStatus='expired'` where this person owns at least one active L1 (`in-production` or `not-started`).
- `flags.retainerRenewalDue: ProjectRow[]` — owned L1s with `engagementType='retainer'` whose `contractEnd` falls in `[today, today + 30 days]`.

**Totals:**

- `totalProjects` sums the non-completed L1 buckets.
- `totalActiveWeekItems` sums `overdue + thisWeek + nextWeek + later`.

## C. Batch mode

Batch mode tags a run of mutations with a `batchId` and suppresses per-mutation Slack notifications so a cleanup run doesn't spam the updates channel.

**Lifecycle:**

1. Call [`set_batch_mode`](#set_batch_mode) with a `batchId` (e.g. `cleanup-2026-04-19`). Batch id is stored in module memory for the current process.
2. Run whatever writes the batch needs — `update_project_status`, `update_week_item`, etc. Every audit row written during this window carries `updates.batch_id = <batchId>`, and Slack posting is skipped.
3. Inspect the result with [`get_current_batch`](#get_current_batch) (still active) or [`get_batch_contents`](#get_batch_contents) (any batch, active or past).
4. Call [`set_batch_mode`](#set_batch_mode) with `null` to clear. Subsequent writes resume untagged + publish to Slack as usual.
5. When satisfied, run `scripts/runway-publish-updates.ts` to group and post the batch to Slack in a single message.

**Caveats:**

- Batch state is per-process, not DB-persisted. A different MCP process / script will not see the batch state set elsewhere.
- Batch mode does not suppress cascade logic — cascades still fire and still write audit rows (they inherit the batch tag).
- `undo_last_change` ignores batch mode.

## D. Cascade model

Runway audit rows chain via `updates.triggered_by_update_id` — a nullable self-reference. The `updateType` column distinguishes parents (`status-change`, `field-change`) from cascade children (`cascade-status-change`, `cascade-date-change`).

**Forward cascade** — triggered by a project mutation:

- `update_project_status` with `newStatus` in the cascade set (`completed`, `canceled`, `on-hold`) → propagates to all linked L2 week items, writing one `cascade-status-change` row per item. See `CASCADE_STATUSES` in `operations-utils.ts`.
- `update_project_field` with `field='dueDate'` → propagates the new date to all linked L2 week items' `date` column, writing one `cascade-date-change` row per item.

Each cascade row gets `triggered_by_update_id = <parent auditId>`, and the parent mutation's `data.cascadeDetail[]` lists every cascade row's `auditId` for traceability.

**Reverse cascade** — triggered by a week item mutation:

- `update_week_item` with `field='date'` on a `deadline`-category L2 that has a parent `projectId` → back-propagates the date to the parent project's `dueDate`. The mutation's `data.reverseCascadeDetail` carries the parent info and audit id.
- No separate audit row is written for the parent project update in this case; the `week-field-change` row owns the trail, and `reverseCascadeDetail.auditId` references it.

**Walking a chain:**

1. Start from any `auditId` you already have — a mutation response's `data.auditId`, a row from [`find_updates`](#find_updates), or a `triggeredByUpdateId` you pulled off another row.
2. Call [`get_update_chain`](#get_update_chain) with that id. It walks up to the root and then fans out to every descendant, ordered by `createdAt` ascending.
3. For a time-windowed overview (not a single chain), use [`get_cascade_log`](#get_cascade_log) — it groups cascade rows by parent id within the last N minutes.
