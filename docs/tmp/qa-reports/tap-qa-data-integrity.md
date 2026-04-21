# QA Report — TAP Data Integrity

**Migration:** `tap-v4-realign-2026-04-21` (batchId `tap-v4-realign-2026-04-21`)
**Pre-snapshot:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-aaa64c46/docs/tmp/tap-v4-pre-snapshot-2026-04-21.json`
**Post-snapshot:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-aaa64c46/docs/tmp/tap-v4-post-snapshot-2026-04-21.json`
**Forward script:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-aaa64c46/scripts/runway-migrations/tap-v4-realign-2026-04-21.ts`
**Reverse script:** `/Users/jasonburks/Documents/_AI_/_R1/.claude/worktrees/agent-aaa64c46/scripts/runway-migrations/tap-v4-realign-2026-04-21-REVERT.ts`
**Prod verified via MCP:** yes (get_clients, get_projects, get_week_items × 5 weeks, get_updates)
**Records touched:** 7 (1 client, 1 L1, 5 L2)
**Field writes:** 13
**Audit rows:** 13

---

## Summary

| Bucket | Count |
|---|---|
| CRITICAL unexplained changes | 0 |
| CRITICAL missing expected changes | 0 |
| INCIDENTAL (audit trail, `updatedAt`) | ~14 (7 records × `updatedAt` + 13 audit rows) |
| PASS (expected matched) | 13 |

---

## Expected delta (from spec + TP handoff)

### Client row
- `tap.team`: `"Owner: Jason, Dev: Tim"` → `"PM: Jason, Dev: Tim"`

### L1 (`ERP Rebuild`, id `3a9c9051793b4d0cb2d396bdb`)
- `name`: `"TAP ERP Rebuild"` → `"ERP Rebuild"`
- `resources`: `"Dev: Tim"` → `"PM: Jason, Dev: Tim"`
- `engagementType`: `null` → `"project"`

### L2 titles (5)
| ID prefix | Old title | New title |
|---|---|---|
| 95f9ce76 | `Development (8 modules)` | `ERP Rebuild — Development` |
| bd6521b3 | `Data Migration — Kickoff` | `ERP Rebuild — Data Migration` |
| 46d5cedb | `Testing & QA — Kickoff` | `ERP Rebuild — Testing & QA` |
| 2776d883 | `Deployment & Go-Live — Kickoff` | `ERP Rebuild — Deployment & Go-Live` |
| 38ae73c9 | `Training & Handoff — Kickoff` | `ERP Rebuild — Training & Handoff` |

### L2 blocked_by chain (4)
| Item | blocked_by set to |
|---|---|
| Development (95f9ce76) | null (chain head) |
| Data Migration (bd6521b3) | `["95f9ce76...."]` (Development) |
| Testing & QA (46d5cedb) | `["bd6521b3...."]` (Data Migration) |
| Deployment & Go-Live (2776d883) | `["46d5cedb...."]` (Testing) |
| Training & Handoff (38ae73c9) | `["2776d883...."]` (Deployment) |

**Total expected writes:** 13 (1 + 3 + 5 + 4). Matches TP handoff count.

---

## Observed delta (pre → post + prod + audit log)

### Expected AND observed — all 13 PASS

**Client row**
- `tap.team` `"Owner: Jason, Dev: Tim"` → `"PM: Jason, Dev: Tim"` — matches post-snapshot and prod `get_clients`. Audit row present (`client-field-change`, 23:53:51).

**L1**
- `projects[0].name` `"TAP ERP Rebuild"` → `"ERP Rebuild"` — matches post + prod. Audit row present (`field-change`, 23:53:52).
- `projects[0].resources` `"Dev: Tim"` → `"PM: Jason, Dev: Tim"` — matches post + prod (name field). Audit row present (`field-change`, 23:53:52).
- `projects[0].engagementType` `null` → `"project"` — matches post-snapshot. Audit row present (`project-field-change`, 23:53:53).

**L2 titles — all 5 PASS**
- All new titles confirmed against prod `get_week_items` for weeks 2026-04-20, 08-17, 08-31, 10-12, 10-26.
- 5 matching `week-field-change` audit rows between 23:53:53 and 23:53:54.

**L2 blocked_by — all 4 PASS**
- All 4 downstream L2s have correct blocked_by JSON in post-snapshot.
- 4 matching `week-field-change` audit rows between 23:53:55 and 23:53:56.
- Development L2 (chain head) correctly remains `blockedBy: null`.

### Expected but NOT observed
- None.

### Observed but NOT expected

#### UNEXPLAINED (CRITICAL)
- None.

#### INCIDENTAL (NON-CRITICAL)
- `client.updatedAt` bumped: `2026-04-20T06:36:28` → `2026-04-20T23:53:51` — expected audit-trail side effect of `updateClientField`.
- `projects[0].updatedAt` bumped: `23:06:58` → `23:53:52` — expected, fires on every field write.
- Each L2 `updatedAt` bumped by ~20s at the time of its title / blocked_by write — expected.
- 13 audit rows inserted with batchId `tap-v4-realign-2026-04-21` — expected (this IS the audit trail).

No silent field drift. Every field in the post-snapshot that differs from pre-snapshot is explained by one of the 13 expected writes or an incidental `updatedAt` touch.

---

## blocked_by chain sanity

**Chain:** Development → Data Migration → Testing & QA → Deployment & Go-Live → Training & Handoff

**Checks performed:**
1. JSON array format — all 4 values are valid JSON arrays of strings (e.g., `"[\"95f9ce76acfd47e19b4cc05f2\"]"`) — PASS
2. Referenced IDs resolve to real TAP L2s under the TAP L1 (verified in pre-snapshot `weekItems[]` and in prod via `get_week_items`) — PASS
3. Chain head (Development) has `blockedBy: null` — PASS
4. No cycles — linear chain, each downstream points only to one upstream with a strictly earlier `weekOf` — PASS
5. Each link matches the narrative dependency described in `projects[0].notes` ("Sequential phases: … Dev (current) → Data Migration → Testing → Deployment → Training. Each phase blocked by predecessor.") — PASS

**Verdict:** blocked_by chain is valid, acyclic, and consistent with the L1 narrative.

---

## Scope-expansion ratification

The spec line for TAP in `overnight-clients-v4-realign.md` is narrow:
- `engagement_type='project'` on all TAP L1s
- Verify team roster on L1s; expand to full if partial
- Dates/statuses per v4 derivation

The agent applied the *generic* v4 rules on top (title reformatting for all L2s, blocked_by chain across 5 L2s, client-name stripping from L1, `Owner:` → `PM:` normalization). This is broader than the TAP-specific bullet list but matches the "generic spec pattern" header of the same doc, which states *every* L1/L2 gets title-format + role-prefix + blocked_by treatment.

Internal consistency checks against `runway-v4-convention.md`:
- Role abbreviations: `PM`, `Dev` both appear in the locked list (`AM / CD / Dev / CW / PM / CM / Strat`). `Owner:` is **not** in the list — the agent's fix to `PM:` is correct. PASS.
- Card title format `[Project Name] — [Specific Milestone]` with em-dash: all 5 new titles follow this exactly. Client-name prefix `TAP` not present. Category word (`Kickoff`) dropped from the 4 kickoff titles. PASS.
- `engagement_type='project'` is a valid enum value. PASS.
- L1.resources = union of owner role + L2 doers matches v4 convention (engagement team). PASS.
- blocked_by as JSON array of L2 ids is the schema-correct representation for Chunk 4's new column. PASS.

**Verdict:** scope expansion is consistent with the v4 convention doc and with the generic-spec header. Ratify.

One minor note worth flagging to TP (not blocking): the spec bullet "Verify team roster on L1s; expand to full if partial" was satisfied, but TAP's team is unusually small (`PM: Jason, Dev: Tim`) compared to other clients (`AM / CD / Dev` triads). If TAP is meant to carry additional roles, that's a data question for the operator, not a migration defect.

---

## Unexplained records

**None.** Only 7 records touched, all in scope (1 TAP client row + 1 TAP L1 + 5 TAP L2s). No collateral writes to other clients, other projects, or unrelated week items.

---

## Confidence

**HIGH.**

Triangulated against three sources:
1. Post-snapshot file (written at 23:54:20)
2. Prod MCP queries (`get_clients`, `get_projects tap`, `get_week_items` × 5 weeks) at QA time
3. Audit log (`get_updates tap` — exactly 13 rows returned, all with `updatedBy: "migration"`, timestamps clustered 23:53:51–23:53:56)

All three agree. No contradictions. Forward script's own `verify()` step also runs in-migration and would have thrown if any field drifted. Reverse script exists and reads from the pre-snapshot for clean rollback path.

---

## Overall recommendation

**ACCEPT.**

13/13 expected field writes applied cleanly. 13/13 audit rows present with correct batchId. blocked_by chain is valid and non-cyclic. No unexplained changes. Scope expansion (title reformatting + blocked_by) is internally consistent with v4 convention doc. `Owner:` → `PM:` normalization is correct per the locked role list. Ratify the TP decisions on both scope expansion and the role-prefix fix.
