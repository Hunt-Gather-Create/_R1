# Runway v4 Convention

**Status:** Locked for PR #86. Supersedes v1 (resources = primary helper) and v2 (resources = team roster on L1 only).

**Purpose:** How L1 (projects), L2 (week items), and clients carry ownership, team, and timing data. This is the authoritative reference for all cleanup migrations, CC prompts, and bot response formatting.

---

## Model at a glance

- **Client** = the customer (Convergix, Bonterra, Soundly, etc.). Carries the global staff roster + contract metadata.
- **L1 (project)** = one real-world engagement under a client. Has an owner (single accountable person) + a resources roster (the team on this engagement). Has start/end dates (derived from children by default; optional manual `contract_end` for retainers).
- **L2 (week item)** = a milestone or workstream under an L1. Has an owner (inherits from L1 by default; can be overridden). Has resources (the specific people working this item). Has start/end dates (end is null for single-day milestones).

Two-level flat hierarchy. No sub-projects. No parent pointers beyond `week_items.projectId -> projects.id`.

---

## Role abbreviations (locked)

Use these prefixes in any `resources` field. Comma-separated.

- `AM` — Account Manager
- `CD` — Creative Director
- `Dev` — Developer
- `CW` — Copy Writer
- `PM` — Project Manager
- `CM` — Community Manager
- `Strat` — Strategy

Client-led work (client is performing the task, not Civ): use plain client name, no role prefix. Example: `Bonterra` for a client-led launch.

---

## Resources field format

`ROLE: Person` per entry.

**Comma = collaboration (peers working concurrently):**
- `CD: Lane, Dev: Leslie` — Lane and Leslie working together on the item
- `CW: Kathy, CM: Sami` — Kathy driving, Sami onboarding

**Arrow `->` = sequential handoff:**
- `CD: Lane -> Dev: Leslie` — Lane does it, then Leslie picks up
- `CW: Kathy -> CD: Lane -> Dev: Leslie` — 3-step chain on one card
- Canonical arrow: `->`. Parser accepts `→`, `=>`, `>>` and normalizes on write to `->`.

**Parsing rule:** within a single resources string, comma = concurrent, arrow = sequential. Mixed: `CD: Lane -> Dev: Leslie, CW: Kathy` reads as "Lane hands to Leslie; Kathy on both sides."

**Applies to L1 and L2.** L1 resources are the engagement team; L2 resources are the specific doers.

**Not required on L2.** If an L2 has a single person doing it (often the inherited L1 owner), resources can be null and team is understood from L1.

---

## L1 (project) fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `owner` | person name, no role prefix | yes | Single accountable person for the engagement |
| `resources` | role-prefixed list | yes when team > 1 | Team on this engagement |
| `status` | `in-production` / `awaiting-client` / `blocked` / `on-hold` / `completed` / `not-started` | yes | See status values below |
| `category` | `active` / `awaiting-client` / `pipeline` / `on-hold` / `completed` | yes | Mirrors status for display grouping |
| `engagement_type` | `project` / `retainer` / `break-fix` | yes | NEW in v4. Enables retainer-specific flows |
| `start_date` | ISO date | derived | Min of children's start_date; manual override via contract_start |
| `end_date` | ISO date | derived | Max of children's end_date; manual override via contract_end |
| `contract_start` | ISO date | optional | Manual override — use for retainers where contract spans past children |
| `contract_end` | ISO date | optional | Manual override — same |
| `contract_status` | `signed` / `unsigned` / `expired` | on clients table already | Surfaced to L1 via client join |
| `waitingOn` | string | optional | Person (or client name) blocking progress |
| `notes` | prose | optional | Context, risks, notable history |

**Derivation rule:** if `contract_start`/`contract_end` are set, use them. Otherwise, derive start from MIN(children.start_date) and end from MAX(children.end_date). Recompute on L2 write.

**`target` and `dueDate` fields:** deprecated in v4. Leave null on new writes. May get removed in a future cleanup PR.

---

## L2 (week item) fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `projectId` | FK to projects.id | yes | Every L2 has one parent L1 |
| `title` | `[Project Name] — [Specific Milestone]` | yes | Drop client name (account field carries it) and category word (category field carries it) |
| `start_date` | ISO date | yes | Replaces legacy `date` field semantically |
| `end_date` | ISO date | null for single-day | Null = same as start; set for spans (retainer, QA window, dev phase) |
| `dayOfWeek` | derived | yes | From start_date |
| `weekOf` | derived | yes | Monday of start_date's week |
| `category` | `kickoff` / `review` / `approval` / `delivery` / `launch` / `deadline` | yes | Drives bot tone + priority derivation |
| `status` | null / `in-progress` / `blocked` / `completed` | null = not-started | `in-progress` on active multi-day work so it surfaces in plate queries |
| `owner` | person name | yes | Defaults to inherited L1 owner; can be overridden explicitly |
| `resources` | role-prefixed list | optional | Specific doers on this task; null = implied from L1 team |
| `blocked_by` | array of week_item ids | optional | NEW in v4. Explicit dependency on upstream L2s |
| `notes` | prose | optional | Context, risk, rationale |

**Owner inheritance rule:** on L2 create, auto-populate owner from parent L1.owner. Stored as an explicit value (not computed). If L1.owner later changes, existing L2s keep their stored owner — operator sweeps manually via bulk update when needed. Prevents surprise data changes.

**`blocked_by`:** list of L2 ids this item is waiting on. Renders as dependency arrows/indent on the board. When a blocker marks `completed`, the downstream L2 becomes "ready to start" in plate queries.

---

## Client fields

Already in schema:
- `name, slug, nicknames`
- `contractValue, contractTerm, contractStatus` — `signed / unsigned / expired`
- `team` — the global staff roster on this client. Format same as resources: `AM: Jill, CD: Lane, Dev: Leslie`. Source of truth for "who works on Convergix."
- `clientContacts` — JSON array of `{name, role?}` objects

L1.resources is a subset of client.team when the engagement doesn't need everyone. Not enforced by code — convention only.

---

## Card title format

`[Project Name] — [Specific Milestone or Event]`

- Drop client name (carried by account/client field)
- Drop category word (carried by category field)
- Use em-dash (`—`) not hyphen

Example: `Impact Report — Dev Handoff`, not `Bonterra Impact Report — deadline handoff`.

---

## Status values

### L1 (project)
- `not-started` — scoped but no work yet
- `in-production` — any phase actively being worked on
- `awaiting-client` — blocked on external input from client
- `blocked` — blocked on internal dependency
- `on-hold` — paused indefinitely
- `completed` — fully done, hidden from active views

### L2 (week item)
- `null` (default) — not started; doesn't surface as "active"
- `in-progress` — actively being worked on; surfaces in plate queries, In Flight view
- `blocked` — halted on upstream (see blocked_by)
- `completed` — done; excluded from active queries (status-aware filters enforce this post-Chunk 1)

---

## Category values

### L1
- `active` — engagement is moving
- `awaiting-client` — paused on external
- `pipeline` — new biz, unsigned SOW
- `on-hold` — dormant
- `completed` — done

### L2
- `kickoff` — starting a workstream or phase
- `review` — internal or team review
- `approval` — waiting for sign-off (client or internal)
- `delivery` — producing an output
- `launch` — going live, client-facing
- `deadline` — hard date, must hit

---

## Convention-driven behaviors (implemented in code)

1. **`getPersonWorkload` L1 filter:** L1 only surfaces for its `owner` (not its resources). Team members see L2s, not L1s, on their plate.
2. **`getPersonWorkload` date bucket:** L2s grouped into `overdue / thisWeek / nextWeek / later`.
3. **Stub filter:** L2s whose parent L1 has `status=awaiting-client` hide from active views. Visible only via L1 drill-down.
4. **Past-end L2 red flag:** L2 where `end_date < today AND status = in-progress` surfaces in red section with note "status unchanged past end_date — needs review."
5. **Retainer renewal soft flag:** L1 with `engagement_type=retainer` within 30 days of `contract_end` surfaces on owner's plate summary.
6. **Contract expiry soft flag:** Client with `contract_status=expired` but L1 active — owner's plate summary mentions it once.
7. **Cascade on all categories:** when L1 status flips to terminal (completed/on-hold), cascade fires for all L2 categories, not just deadline.
8. **triggeredByUpdateId:** cascade-generated audit rows carry FK to the parent update that triggered them.
9. **Priority derivation from category:** launch/deadline = high; approval = medium; kickoff/review/delivery = normal. Bot phrasing reflects tone.

---

## What v4 changes from overnight work

| Item | Overnight state (v1) | v4 expected |
|---|---|---|
| L1.resources | Primary helper only (`CD: Lane`) | Full team roster (`AM: Jill, CD: Lane, Dev: Leslie`) |
| L2.owner | Often populated (various people) | Inherits L1.owner unless overridden |
| L2.date | Single date | start_date + end_date (end null for single-day) |
| L1 engagement_type | Absent | New enum, populated per engagement |
| Retainer L2 | Hack: single date + notes describe span | First-class: start/end dates express span |
| blocked_by | Implicit in notes | Explicit array of L2 ids |
| L1 status flip | Often missed during consolidation | Playbook enforces flip to in-production when phases active |

Cleanup touchups per client will bring overnight state to v4 during Wave 1-3.
