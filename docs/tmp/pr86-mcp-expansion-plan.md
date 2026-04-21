# PR #86 — MCP Expansion Plan

**Context:** PR #86 v4 convention work shipped the internal functions and schema, but the MCP/bot tool surfaces were not fully enriched. Per `docs/brain/brain-MCP-ENRICHMENT-PLAN.md`, the original intent was single-PR delivery of all three tiers. Operator confirmed on 2026-04-20: roll the full MCP expansion into PR #86.

**Branch:** `feature/runway-pr86-base` at HEAD commit `f7be99b` (post-createClient-fix).
**Working dir:** `/Users/jasonburks/Documents/_AI_/_R1/.worktrees/runway-v3-cascade`
**Do not push.** Operator approval required before push.

---

## Scope rolled in

### Tier 1 — Read enrichment (additive)
| Tool | Fields to add |
|---|---|
| `getProjectsFiltered` | `id`, `dueDate`, `updatedAt`, `resources`, `startDate`, `endDate`, `engagementType`, `contractStart`, `contractEnd` |
| `getWeekItemsData` | `id`, `projectId`, `clientId`, `status`, `updatedAt`, `batchId`, `startDate`, `endDate`, `blockedBy` |
| `getClientsWithCounts` | `id`, `updatedAt`, optional `includeProjects` flag |
| `getUpdatesData` | params: `since`, `until`, `batchId`, `updateType`, `projectName` |

### Tier 2 — New query functions
- `getOrphanWeekItems(clientSlug?)` — week items with no projectId
- `getWeekItemsInRange(fromDate, toDate, clientSlug?, owner?, category?)`
- `findUpdates(since?, until?, clientSlug?, updatedBy?, updateType?, batchId?, projectName?)`
- `getUpdateChain(updateId)` — follow cascade via `triggeredByUpdateId`

### Tier 3 — Observability (new file: `operations-reads-health.ts`)
- `getDataHealth()` — totals, unlinked count, stale count, batch state
- `getCurrentBatch()` — active batch id + metadata
- `getBatchContents(batchId)` — all audit rows in a batch
- `getCascadeLog(windowMinutes)` — recent cascades via updates filter

### Plus two additions I proposed and operator approved
- `getFlags(clientSlug?, personName?)` — single surface for past-end, stale, bottleneck, retainer-renewal, contract-expired
- `getClientDetail(slug)` — deep view (team, contacts, contract, all projects, pipeline, recent updates)

### Write response shape
All mutation functions return `{ok, message, data: {cascadedItems?, reverseCascaded?}}` as JSON content block.
- `updateProjectField` returns cascadedItems on dueDate changes
- `updateWeekItemField` returns reverseCascaded on deadline-category date changes
- `updateProjectStatus` returns cascadedItems from all-category cascade

### Tool registration work (Phase 2)
- Register every new function as MCP tool in `src/lib/mcp/runway-tools.ts`
- Mirror every one in `src/lib/slack/bot-tools.ts`
- **Audit ALL tool descriptions** (both surfaces) for drift vs v4 response shapes — especially `get_person_workload` which returns `{ownedProjects, weekItems (bucketed), flags, totals}` not "grouped by client"
- Update `src/lib/runway/bot-context-sections.ts` prompt to teach bot about `flags.contractExpired` and `flags.retainerRenewalDue`
- Route integration tests at `src/app/api/mcp/runway/route.test.ts` and `src/lib/mcp/runway-server.test.ts`

### Docs + PR (Phase 3)
- `docs/mcp-runway-tools.md` — checked-in location (NOT `docs/reference/` which is gitignored). Full tool list, params, return shapes.
- Update `docs/tmp/pr86-message-draft.md` to cover the MCP expansion. Fix commit count (66 not 61), function names (`updateWeekItemField`, `addProject`), acknowledge eslint change + docs/tmp artifacts.

### Preflight (Phase 4)
- `pnpm test:run` — expect well above 1669
- `pnpm lint` — 0 errors
- `pnpm build` — clean
- `gh pr edit --body-file docs/tmp/pr86-message-draft.md` to update PR #86 body
- Operator approves push

---

## Explicitly skipped (out of scope even with more time)
- Drop `projects.target` column — separate PR, breaking change
- Week item status enum standardization — behavioral + data migration
- Title convention migration — one-off script post-merge

---

## Execution phases

**Phase 1 — 3 parallel agents**
- Agent 1 owns: Tier 1 read enrichment + Tier 2 new read functions + getFlags + getClientDetail. Touches `operations-reads.ts`, `operations-reads-week.ts`, maybe `operations-reads-updates.ts` (or similar). Adds unit tests co-located. Reports back with function signatures for Phase 2.
- Agent 2 owns: Tier 3 health functions. Creates `operations-reads-health.ts`. Unit tests. No dependency on Agent 1.
- Agent 3 owns: Write cascade response shape refactor. Touches `operations-writes-project.ts`, `operations-writes-week.ts`, `operations-writes.ts`, and all their tests. No dependency on Agents 1 or 2.

**Phase 2 — 1 sequential agent** (blocked by Phase 1)
- Agent 4 wires everything from Phase 1 into `runway-tools.ts` + `bot-tools.ts`. Audits all descriptions. Updates `bot-context-sections.ts` for flags awareness. Adds route integration tests.

**Phase 3 — 2 parallel agents** (blocked by Phase 2)
- Agent 5: Reference doc at `docs/mcp-runway-tools.md`
- Agent 6: PR message rewrite at `docs/tmp/pr86-message-draft.md`

**Phase 4 — TP runs preflight + PR body update via Bash**

---

## Guardrails for all agents

- **DO NOT `git push`** — operator wants gate-keeper control
- **DO NOT amend** existing commits — new commits only
- **Each agent creates its own commits** with clear scoped messages (chore/feat/refactor as appropriate)
- **Tests co-located, not in a final omnibus commit** — per project workflow rules
- **Every change additive** — no breaking shape changes beyond what already exists in v4
- **If anything is unclear, STOP and report** — do not guess
- **Report back with:**
  - Commits created (hashes + titles)
  - Function signatures added (for Phase 2 to wire)
  - Any surprises or scope drift
  - Files touched

---

## Final shape after merge

- ~35 MCP tools total (25 existing + 10 new)
- Mirrored in bot-tools for Slack bot
- All descriptions accurate to v4 response shapes
- Full reference doc
- Enriched PR body
- 1669 → ~1750+ tests (estimated)
- PR #86 diff grows but stays scope-coherent
