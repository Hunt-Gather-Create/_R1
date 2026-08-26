# Substrate Reuse Brief

**Purpose:** Research brief for Runway safe-write tool design. Covers what Substrate is, its status, its write-gating logic, and which pieces Runway can adopt.

**Source project:** `/Users/jasonburks/Documents/_AI_/Civilization-Skill-Suite/civ-substrate`

**Date:** 2026-08-14

---

## 1. What Substrate Does + Architecture

Substrate is a shared, durable memory layer for every AI role in AgencyOS. It solves the cold-start problem: AI sessions no longer start from zero. It stores client profiles, stakeholder data, account history, craft knowledge, and fleet operating standards across sessions and roles.

### Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+, ESM, pnpm |
| Database | libSQL (Turso cloud), SQLite fallback for local |
| ORM | Drizzle ORM, hand-authored migrations |
| Embeddings | BGE-M3 (BAAI/bge-m3) via local ONNX. No API cost. 1024 dims, truncated to 512 in practice |
| Retrieval | Hybrid: BM25 (SQLite FTS5) + dense vector search, fused by Reciprocal Rank Fusion (RRF). Optional cross-encoder rerank |
| Conflict detection | Claude Sonnet, gated behind a cosine pre-filter (0.6 threshold) to cap LLM calls |
| IDs | ULID |
| Slack operator surface | @slack/bolt 3.22.0 |

### Three databases

| DB | Purpose | Key tables / pillars |
|---|---|---|
| `am.db` | Account Manager role memories | `decisions`, `engagement_state`, `input_summaries`, `source_pointers`, `craft_playbook` |
| `shared.db` | Agency-wide truth; any role can read | `client_profile`, `stakeholders`, `account_history`, `voice_rules`, `brand_decisions`, `agency_playbook` |
| `fleet.db` | Fleet/Overwatch operational memory | `coding_standards`, `skills_usage`, `fleet_behavior` |

Note: an earlier design used SQLite ATTACH for one DB per role. Turso deprecated that for new accounts in January 2025. Role separation now lives at the library layer, not the DB layer.

### Five-stage memory lifecycle (namespace progression)

Every memory record moves through these stages in order:

1. `raw_research` — unfiltered source material on intake
2. `extracted_learnings` — distilled principles, tagged and scored, flagged for operator review
3. `applied_sessions` — what the role actually used in live work
4. `canonical` — human-approved trusted rules (requires structured provenance)
5. `rejected_or_stale` — demoted records. Never deleted; restorable.

---

## 2. Staging vs Prod Status

**Current status: 72% complete. PARKED as of 2026-08-09.**

### What is built and working

- All 8 internal build phases declared complete (milestone: 2026-07-03).
- 1,300+ tests in the suite.
- Full recall, remember, housekeeper, MCP toolkit, Slack surfaces, and CLI exist as working code.
- W0-b pilot: 20 memories loaded, 20/20 recall hit at k=10 on live Turso. Dedup, quota, and telemetry all behaved.
- MCP daemon is live at `src/mcp/daemon.js`. The tools in the fleet (`mcp__agencyos-memory-substrate__*`) come from this.

### What is missing before prod is live

1. **Backfill incomplete.** Beat 4 backfill only completed 2 of 17 batches (LPP Website Revamp only). 15 client buckets and ~35 active projects are not yet loaded.
2. **No live callers.** AM SKILL.md is not confirmed wired to call `recall` before work or `apply_after_task` after. Substrate has zero live callers today.
3. **Slack smoke test not confirmed.** Operator has not clicked A/B/C on a real Slack review message.
4. **One failing test.** `test/slack/button-resolve.test.js:177` hits a read-only Turso token. Fix: mock injection.
5. **Three open risks (GH issues):**
   - Issue 71: pre-rotation write tokens may still be live
   - Issue 72: three API features may throw silently
   - Issue 73: unbounded table growth, no purge path yet

### Ingestion wave status

| Wave | Content | Count | Status |
|---|---|---|---|
| W0-a | Ingestion contract, fleet.db schema | — | DONE |
| W0-b | Pilot 20 memories end-to-end | 20 rows | DONE |
| W1-a | Fleet/Overwatch store | 103 files | PENDING |
| W1-b | Skills-usage corpus | 81 SKILL.md files | PENDING |
| W1-c | Coding standards | ~7 docs | PENDING |
| W2 | AM role memories + shared AM docs | 125+ files | PENDING |
| W3 | Meeting notes, client shards | 448 files, 11 clients | PENDING |
| W4 | Reconciliation + Holdout adversarial QA | — | PENDING |

**Blocker before W1:** fleet pillars are not on the ratification allowlist. All 103 W1-a rows would land `needs_review=1`. Operator or schema owner must extend the allowlist or design a batch-ratify step. Routed to Overwatch.

---

## 3. Safe-Write Mechanism + Logic Layers

This is the core design Runway cares about. Substrate has four interlocking layers.

### Layer 1: Ratification tier routing (`ratification.js`)

Every write is routed to one of three tiers:

| Tier | Behavior | Routing rule |
|---|---|---|
| **auto-land** | Writes immediately, 25% sampled for review | Deterministic SHA-256 hash + pillar allowlist in `config/scoring.json` |
| **gated** | Writes but sets `needs_review=1` | Any write not on the auto-land allowlist |
| **blocked** | Rejected, no write | Explicit block rules (e.g., cross-role write attempts) |

Key design choice: tiering comes from a static pillar allowlist, not LLM judgment. This makes the routing deterministic and auditable.

### Layer 2: Permission matrix (`capabilities.js`)

- Enforces per-connection-type permissions.
- Cross-role reader connections refuse `remember`, `promote`, `demote`, `apply`, and `flag_conflict`.
- Agents that can hallucinate do NOT hold write credentials. Only the deterministic staged loader does.

### Layer 3: Dedup check

Before every write, Substrate checks cosine similarity against existing memories in the same namespace and scope:

- Threshold: **0.92** cosine similarity.
- Above threshold: merge or reject, not a duplicate write.
- Below threshold: proceed to ratification routing.

### Layer 4: Provenance requirement for canonical writes

- Canonical namespace writes require `provenance_source_id` and `provenance_source_span`.
- The proposed text must be diffable against the source.
- Primary defense against memory poisoning (OWASP ASI06 2026).

### Queue caps

- `needs_review=1` queue capped at **200 items**.
- Items older than 60 days auto-reject.

### Trust vs confidence separation

- `confidence` is set at write time based on source type: operator input = 0.9, meeting transcript = 0.7, external research = 0.5.
- `trust_score` is a separate field that rolls forward based on usage and conflict resolution. It is not set at write time.

### Conflict detection

- A cosine pre-filter (threshold: **0.6**) gates whether an LLM conflict-detection call fires at all.
- Only if cosine similarity exceeds 0.6 does the system call Claude Sonnet to check for a true logical conflict.
- This caps LLM spend on the hot write path.

---

## 4. Reusable Pieces for Runway's Safe-Write Tool

Runway needs a programmatic safe-write tool (used by TP, not a separate role) to write to Runway's staging + prod DB with logic that decides what actually needs updating — analogous to how not every detail from a meeting needs to change Runway. Below are the Substrate patterns Runway can adopt concretely.

### 4a. Ratification tier routing

**What it is:** A static config-file allowlist (`config/scoring.json`) that routes writes to auto-land, gated, or blocked — no LLM involved in the routing decision.

**How Runway adopts it:** Runway's safe-write tool should have an equivalent `runway-write-allowlist.json` that classifies field + status combinations. For example: `statusField` + `in-progress` + `meeting-sourced` = gated (needs TP review before landing). `taskNo` + append = auto-land. Anything touching `budget` or `contractEnd` = blocked without explicit override. This makes every write traceable and auditable without burning tokens on routing.

### 4b. Confidence scoring by source type

**What it is:** Substrate assigns `confidence` at write time based on where the proposed value came from (operator direct input = 0.9, transcript = 0.7, research = 0.5).

**How Runway adopts it:** Runway writes come from two main sources: meeting transcripts and operator direct input. The safe-write tool should tag every proposed change with a `sourceType` (transcript, operator, sheet-sync, derived) and a confidence level. Low-confidence writes (transcript-sourced changes to high-stakes fields like `contractEnd` or `budget`) get gated; high-confidence writes (operator direct) auto-land. This mirrors DI-TP's existing manual caution about transcript-sourced scope changes.

### 4c. Dedup / no-op check

**What it is:** Substrate checks cosine similarity before writing to catch semantic duplicates. Threshold: 0.92.

**How Runway adopts it (adapted):** Runway does not need vector embeddings for its simpler structured data. The equivalent is a **field-level diff check**: before writing any field, compare proposed value to current DB value. If they are equal (or meaningfully equivalent — e.g., date format difference only), skip the write entirely and log it as a no-op. This prevents ghost updates that would pollute the audit trail. The DI-TP already does this manually; the safe-write tool should automate it.

### 4d. Provenance requirement for high-stakes writes

**What it is:** Substrate requires `provenance_source_id` and `provenance_source_span` for any write into the canonical namespace.

**How Runway adopts it:** High-stakes Runway fields (budget amounts, contract dates, SOW references, status flips to `complete` or `canceled`) should require a `sourceRef` — a pointer back to the meeting transcript ID, sheet row, or operator session that justified the change. This is the "show your work" requirement. It makes the audit trail reconstructible and is the equivalent of Substrate's canonical provenance guard.

### 4e. Adapter / repository interface pattern

**What it is:** Substrate uses a clean-architecture separation: business logic never touches the DB directly. Each record type has a named repository with typed methods.

**How Runway already anticipated this (see §9.4):** The schema plan signal at `/Users/jasonburks/Documents/_AI_/_R1/docs/tmp/signals/tp-to-alpha.txt` (lines 1024-1044) establishes §9.4: the `sheet_registry`, `sheet_sync_ledger`, and `updates` rows for `cascade-decision` / `sheet-version` / `sheet-version-intent` are all substrate-candidate memories. The constraint is: **v1 backend = Runway Turso** (unblocks Stage 2 immediately); **v2 backend = substrate-via-MCP later** (swap is one-file-per-record-type). Named adapter methods in the Runway plan: `ledger.register(...)`, `versionRegistry.bump(...)`, `cascadeDecisions.record(...)`. The module noted as substrate-swappable in `docs/runway.md` (line 92) is `sheet-sync-ledger-repo.ts`.

**Key takeaway:** The adapter interface is already required by the Runway schema plan. The safe-write tool should implement its write path through these named repository methods, never through raw Turso calls. That is the only thing needed to make a substrate swap a one-file change later.

### 4f. Queue cap + auto-reject for stale pending writes

**What it is:** Substrate caps the `needs_review=1` queue at 200 items and auto-rejects anything older than 60 days.

**How Runway adopts it:** The safe-write tool should enforce a similar cap on its "pending TP review" queue. If the queue grows beyond a threshold (suggest 50 items for Runway's scale), the tool should surface a warning rather than silently accumulating. Stale proposed changes (from a meeting 30+ days ago that was never acted on) should auto-expire rather than sit as live candidates.

---

## 5. Integration Seam: Where Runway Already Anticipated a Substrate Swap

Two places in the _R1 codebase already name the substrate seam:

1. **`docs/runway.md`, line 92** — `sheet-sync-ledger-repo.ts` is annotated as "Turso v1 backend; substrate-swappable." This is the ledger adapter. When Substrate reaches prod, this file is the swap point.

2. **`docs/tmp/signals/tp-to-alpha.txt`, lines 1024-1287** — §9.4 "Substrate Migration Path" establishes: (a) no hardwiring of storage access into business logic; (b) adapter-interface layering so v2 substrate swap is one-file-per-record-type; (c) the specific record types flagged as substrate candidates: `sheet_registry`, `sheet_sync_ledger`, `cascade-decision`, `sheet-version`, `sheet-version-intent`. The constraint is still in effect as of the most recent TP signal (line 1230).

The Runway safe-write tool does not need to call Substrate today. It needs to be built behind the repository/adapter interface shape so the v2 swap is cheap when Substrate reaches prod.

---

## Sources

- `/Users/jasonburks/Documents/_AI_/Civilization-Skill-Suite/civ-substrate/` — project root (README, architecture docs, schema, restart prep plan dated 2026-08-09)
- `/Users/jasonburks/Documents/_AI_/_R1/docs/runway.md` — `sheet-sync-ledger-repo.ts` substrate annotation (line 92)
- `/Users/jasonburks/Documents/_AI_/_R1/docs/tmp/signals/tp-to-alpha.txt` — §9.4 substrate adapter constraint (lines 1024-1287)
- `/Users/jasonburks/Documents/_AI_/_R1/di-tp-exit-debrief.md` — coordination substrate signal-lane gotcha (line 244)
