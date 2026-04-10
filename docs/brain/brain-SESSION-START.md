# brain-SESSION-START.md
## Round One: Project Management + Resource View
**Civilization Agency — Internal Build**
*Last updated: April 9, 2026*

---

## §0 How This Doc Works

Read this file first, every session, before doing anything else. It tells you what this project is, exactly where we are, and what to do next. It points to other docs — don't load them unless the task requires them. Keep this file current. When Jason says "button up" or "wrap up," updating this doc is the first thing that happens.

Other brain docs and when to load them:
- `brain-PRODUCT-VISION.md` — load when making product decisions, reviewing scope, or onboarding a new session to the full product intent
- `brain-RULES.md` — load when executing a build session, handling git, dispatching agents, or when something breaks and you need the rules

Memory files with standing guidance (always loaded via MEMORY.md):
- `feedback_no_ai_voice.md` — no em dashes or AI-sounding language in any user-facing output
- `feedback_security_first.md` — match Tim's auth patterns exactly, never expose data/keys
- `feedback_image_cataloging.md` — use subagents for bulk image work, never read images in main context

---

## §1 What This Is

Round One is an agency project management and resource visibility platform built for Civilization Agency. It is built on the _R1 fork (Tim Warren's AI Starter stack: React, Tailwind, shadcn/ui, Turso, Vercel). The product has three layers: a core PM tool with dependencies and timelines, a canvas-based client storytelling layer that sits above the project data (the USP — nothing like it exists), and a resourcing view that shows cross-project capacity. There is also a Phase 0 POC that needs to ship first: a real-time TV display and password-protected web view showing everything currently in flight at the agency.

This project is separate from Open Brain. Do not conflate them.

Full product intent lives in `brain-PRODUCT-VISION.md`.

---

## §2 Current Status and Next Actions

**Status as of April 9, 2026:**

| Item | Status |
|---|---|
| Vision doc | Done |
| Rules doc | Done |
| Session-start doc | Done |
| Competitive research | Done — PM tools (Monday, Asana, Teamwork), resourcing (Float, Resource Guru, Productive), canvas (Miro, FigJam, Notion, Gamma) |
| Inspiration screenshots | Done — 42 files in `/sources/inspiration/` with `CATALOG.md` and `REQUIREMENTS.md` |
| Inspiration QA pass | Done — ~120 user stories extracted, 8 view types, 13+ element types, 4 zoom levels, theme system |
| _R1 INIT (codebase discovery) | Done — `/docs/reference/codebase-map.md` |
| Gap analysis | Done — `/docs/reference/gap-analysis.md`. 3 conflicts, 30+ items assessed, dependency-ordered build priority |
| **Phase 0: Runway build** | **Done** — PR #77 merged. 6 Turso tables, board at `/runway`, MCP server, Slack bot, updates channel. |
| **Phase 0: Deploy** | **Done** — Live at `runway.startround1.com/runway`. Tim deployed from `runway` branch (not main). Separate Vercel project. |
| **Phase 0: Battle test** | **Done** — TV audit, 3 bugs fixed, BLOCKED styling added. PR #78 merged. 736 tests. |
| **Phase 0: Data intake (Jill)** | **Done** — 6 new clients, existing clients updated, account leads mapped, DB re-seeded (13 clients, 77 projects, 39 week items, 7 pipeline items). |
| **Phase 0: Slack integration** | **Done** — Event subscriptions configured, bot responds to DMs in production. |
| **Phase 0: UI improvements** | **Done** — PR #79 merged. Week dividers, card hierarchy, day column scrolling, By Account project grouping, Pipeline cleanup, auto-refresh, weekend merge. |
| **Phase 0: Bot intelligence** | **Done** — Dynamic system prompt with query recipes, reference data (clients.ts, team.ts), tool filters (owner, resource, waitingOn), workload/contacts tools. Sonnet 4.6 model. Morning briefing pattern. |
| **Phase 0: AI flags panel** | **Done** — Fixed right sidebar: resource conflicts, stale items, deadlines, bottlenecks. Severity grouping (critical/warning/info). |
| **Phase 0: Updates queue** | **Done** — Needs Update section above Today. Stale items from previous days that lack updates. |
| **Phase 0: Account leads** | **Done** — Proactive follow-up after bot processes an update. Checks stale items on accounts the person leads. |
| **Phase 0: Card standardization** | **Done** — DayItemCard uses MetadataLabel, consistent layout across views. Unlabeled dates removed from By Account. |
| **Phase 0: Slack image support** | **Done** — Bot receives image attachments from DMs, downloads via Slack API, passes as content blocks to Claude. `files:read` scope added. |
| **Phase 0: Owner/resource separation** | **Done** — Schema has `resources` on weekItems/projects, `owner` on pipeline. All 39 week items triaged with owner/resource assignments. Bot tools and query recipes updated. |
| **Phase 0: Updates channel** | **Done** — Formatted posts to private Slack channel on every write. Fixed idempotency bug that was swallowing `data` on retries. Bot added to channel. |
| **Phase 0: Bot testing** | **Done** — Full QA pass: identity, date context, "my plate" morning briefing, CGX queries, pipeline, writes with updates channel post, image attachments, client contacts. All passing on Sonnet 4.6. |
| **Phase 0: Pipeline status overhaul** | **Done** — CC ran prompt. Lifecycle: scoping, drafting, sow-sent, verbal, signed + at-risk flag. |
| **Phase 0: Status cascade** | **Done** — Project status changes cascade to linked week items (completed/blocked/on-hold). Seed script links 15/39 items via fuzzy matching. 4 cascade scenarios tested. |
| **Phase 0: Real-user rollout** | **Done (failed)** — April 8. Allison and Leslie tested. Bot failed at multi-turn conversations, couldn't create projects or update fields, faked success on deadline changes, nagged about unrelated tasks. |
| **Phase 0: Bot v2** | **PR #81 up** — Thread history, 6 new write tools, capability boundaries, proactive nudge overhaul, fuzzy matching with dash normalization, undo, prompt caching. 8 commits, 1213 tests. Awaiting merge. |
| Phase 0: Data intake (Allison, Ronan, Jason) | Blocked on bot v2 merge + deploy. |
| User stories (4-pass) | Not started — next after Phase 0 ships |
| Full product `/plan` | Not started |

**Immediate next action:** Merge PR #81. Tim deploys from `runway` branch. Run `pnpm db:migrate` (new metadata column) then `pnpm runway:seed`. Verify bot with Allison and Leslie. Remaining QA sessions: Allison, Ronan, Jason.

---

## §3 Phase 0: Runway

Runway is Civilization Agency's triage tool. It puts everything in flight, waiting, and in the pipeline on one screen. Runs on the office TV and is accessible via web. Updated through Slack DMs with an AI bot. Branded "Civilization Runway" — not "triage view" or anything that signals crisis.

### Three pieces

**1. The Board (Web View)** — Route: `/runway`. Three views: This Week (day-by-day), By Account, Pipeline. TV-readable: large type, clear status colors, high contrast. Read-only display — all writes come through Slack.

**2. The Slack Bot (Update Layer)** — 1:1 DM channels between bot and team members. Conversational: person tells bot what changed, bot confirms before writing. Deduplication via idempotency keys. Thread history for multi-turn conversations. 14 tools (reads + writes). Proactive nudge on first message only, filtered by owner/resource. Confirmation before destructive changes.

**3. The Updates Channel (History Log)** — Shared Slack channel (Jason + Kathy). Passive, read-only log of every change. One message per project update. Format: client name, project, update, updated by with emoji indicator (green = Civ employee, blue = client contact). No AI voice.

### Architecture

All three access paths (Slack bot, MCP server, board) share a single operations layer. No duplicated DB logic.

```
Slack DM → webhook → HMAC verify → Inngest → AI bot (Sonnet) → shared operations → Turso DB
                                                                         ↑
MCP clients (Claude Code, Open Brain) → bearer auth → MCP server → shared operations
                                                                         ↓
Board UI ← server component ← queries ← Turso DB        Updates channel (Slack)
```

### Separate database

Runway uses its own Turso instance (`RUNWAY_DATABASE_URL`) on Jason's free tier. Same technology as R1's main database — migration to the R1 instance is straightforward when ready. Schema is purpose-built for triage but data maps directly to the full PM model.

### Employee roster

| Person | Title | Role | Accounts Led | Slack ID |
|---|---|---|---|---|
| Kathy Horn | Co-Founder / Executive Creative Director | leadership | Convergix | U11NL4SBS |
| Jason Burks | Co-Founder / Development Director | leadership | TAP | U1HH41TFX |
| Jill Runyon | Director of Client Experience | am | Beyond Petro, Bonterra, AG1, EDF, ABM | U08TZ6ZDEUF |
| Allison Shannon | Strategy Director / Sr. Account Manager | am | Wilsonart, Dave Asprey | U06BA311N92 |
| Lane Jordan | Creative Director | creative | -- | U03F7MED8F8 |
| Leslie Crosby | Sr. Frontend Dev / Technical PM | dev | -- | U01LJGMC1GV |
| Ronan Lane | Senior PM | pm | Hopdoddy, LPPC, Soundly | *(missing)* |
| Sami Blumenthal | Community Manager | community | -- | U0AFM4FG87P |
| Tim Warren | Director of AI | dev | -- | U016N17D9KR |

### Client contacts

Daniel (Convergix, primary), Nicole (Convergix), Tom (LPPC), Blake Cadwell (Soundly), JJ Kalscheur (Convergix, New Capacity), Bob Bove/Jared (Convergix, CDS), Abby Compton (Beyond Petrochemicals), Lisbeth Jakobsen (RLF), Chris (HDL, copywriter), David Rosen (HDL, founder), Jeff Chandler (Hopdoddy).

### Env vars (6)

| Variable | Purpose |
|---|---|
| `RUNWAY_DATABASE_URL` | Turso connection URL |
| `RUNWAY_AUTH_TOKEN` | Turso auth token |
| `RUNWAY_MCP_API_KEY` | Bearer token for MCP endpoint |
| `SLACK_BOT_TOKEN` | Slack app bot token |
| `SLACK_SIGNING_SECRET` | HMAC signing secret |
| `SLACK_UPDATES_CHANNEL_ID` | Channel for update logs |

### Key decisions

- Branding: "Civilization Runway" — forward-looking, not crisis-mode
- Dark theme for now — matches R1. Light/airy Civilization brand in full theme refactor later
- Slack is the input layer — zero new behavior for employees
- AI confirms, doesn't gatekeep — no approval chain beyond the 1:1 DM
- No AI voice in outputs — no em dashes, no generated-sounding summaries
- Deduplication is non-negotiable — idempotency keys on every write
- Phase 0 is foundation — every decision aligns with gap analysis architectural decisions
- Proactive nudges later — start reactive, earn trust

### What lives on vs. gets replaced

| Component | Phase 0 (Now) | Full Product (Later) |
|---|---|---|
| Data source | Separate Turso DB, flat schema | Main R1 database, full relational schema |
| Board view | `/runway` route, static display | Portfolio/agency view with real-time data, filters, drill-down |
| Slack bot | 1:1 updates, status changes | Could expand to full PM interactions |
| Updates channel | Passive log | Could become activity feed inside the app |
| Day-by-day triage | Manual data entry via Slack | Auto-generated from dependencies, due dates |
| Pipeline view | Flat list of unsigned SOWs | Integrated with client entity, sales pipeline |

### Remaining Phase 0 work

**Step 6: Deploy** — Done. Live at `runway.startround1.com/runway`. Tim deployed from `runway` branch as a separate Vercel project (not main). PRs target `runway` branch on `Hunt-Gather-Create/_R1`. `upstream` remote configured locally.

**Step 6.5: Slack integration** — Done. Event Subscriptions configured, bot responds in production. Event URL currently pointed at ngrok for local testing -- swap back to production before closing out.

**Step 7: Data intake** — Jill's intake done (PR #78). Remaining: Allison (Wilsonart, Dave wind-down), Ronan (Hopdoddy retainer burn, LPPC, Soundly AARP signing urgency), Jason (TAP deeper interview). QA questions stockpiled for each. Thursday 4/9: review client reference data.

**Step 8-8.8:** All built and tested on `feature/runway-bot-context` (40+ commits, 1017+ tests). PR pending.

- **8.0 UI improvements** — Week dividers, card hierarchy, By Account grouping, Pipeline structure, auto-refresh, kiosk mode.
- **8.5 AI Flags Panel** — Fixed right sidebar: resource conflicts, stale items, deadlines, bottlenecks.
- **8.6 Updates Queue** — Stale items from previous days bubble up as "Needs Update" above Today.
- **8.7 Account Leads** — Proactive follow-up on accounts the person leads. Core value prop.
- **8.8 Bot Intelligence** — Sonnet 4.6 model, dynamic system prompt with query recipes, morning briefing pattern (owner/resource framing, time ladder, stale item surfacing). Full QA pass complete.
- **8.9 Owner/Resource Separation** — Schema + data + bot tools + UI. All 39 week items triaged.
- **8.10 Updates Channel** — Formatted posts on every write. Idempotency bug fixed.
- **8.11 Pipeline Status Overhaul** — Lifecycle: scoping, drafting, sow-sent, verbal, signed + at-risk.
- **8.12 Status Cascade** — Done. Project status changes cascade to linked week items.
- **8.13 Image Support** — Done. Bot receives and processes image attachments. `files:read` scope added.
- **8.14 Card Standardization** — Done. DayItemCard with MetadataLabel, consistent layout.
- **9.0 Bot v2 (PR #81)** — Thread history (conversations.replies, 20-message cap). 6 new tools: create_project, update_project_field, create/update_week_item, undo_last_change, get_recent_updates. Capability boundaries prompt. Proactive nudge: once per thread, owner/resource filter, on-hold skip. Fuzzy matching: dash normalization, disambiguation. Undo: null previousValue, sequential walk, field validation via metadata column. Prompt caching via providerOptions. Confirmation rules, multi-update guidance, MAX_STEPS=12. Duplicate project guard. 1213 tests.

---

## §4 The Road Forward (Post-Phase 0)

The pre-build sequence for the full product (research, inspiration, INIT, gap analysis) is complete. Phase 0 was built directly from the brain spec rather than going through the 4-pass story method — right call for a fast POC. The full product needs the structured approach.

### Step 5: 4-pass user story session

Input: vision doc, gap analysis, inspiration REQUIREMENTS.md. All passes happen inside Claude Code so the codebase is in context during acceptance criteria writing — this makes criteria technically grounded, not aspirational.

**Pass 1 — Story generation.** Feed Claude the vision doc, gap analysis, and inspiration screenshots. Generate all user stories in standard format. Don't filter. Expect 60-100 for the full product.

**Pass 2 — Acceptance criteria.** For every story, 2-4 binary pass/fail criteria. Not vibes ("the canvas feels flexible") — verifiable behavior ("A user can add a free-floating text box to a canvas view that has no connection to any project task, and it persists on save").

**Pass 3 — Epic grouping and dependency mapping.** Group stories into epics. An epic maps roughly to one work tree — everything in that epic can be built without touching files another epic owns. Surface dependencies as explicit "blocked by" relationships.

**Pass 4 — /plan with stories as input.** This IS the /plan step, but with structured input. Every task traces to a story, every story has acceptance criteria, every epic has a clear "done" definition. Instruction to /plan: produce a milestone plan where each milestone maps to an epic, break into work-tree-safe modules without file conflicts, make dependencies explicit, identify parallelism. Output: `/docs/build-plan.md`.

Key insight: /plan is great at organizing decisions already made. It struggles when inferring product intent. The 4-pass method ensures all intent is explicit before /plan runs.

### Step 6: Revisit inspiration file

42 screenshots in `/sources/inspiration/` with CATALOG.md + REQUIREMENTS.md. A significant amount of analysis work went into this — 8 distinct view types, 13+ canvas element types, 4-level zoom hierarchy, dark/light theme system, template/stamp patterns identified. Cross-reference against user stories to ensure Layer 2 canvas requirements are fully captured. These screenshots are the exact deliverable types the canvas layer must produce.

### Step 7: Full product /plan

With the complete story set, gap analysis, vision doc, and inspiration requirements as context. Output: `/docs/build-plan.md`. Expected milestones roughly: L1 foundations → core PM enhancements → Canvas Layer → Resourcing Layer → Portfolio View.

### Step 8: Work trees

Each work tree gets: vision doc, its epic's stories + acceptance criteria, full build plan for dependency awareness. Sub-plan inside each work tree before executing. Compact aggressively (60% start wrapping, 70% definitely wrapping, 80% should already be done).

---

## §5 File Map

| File | Purpose | When to load |
|---|---|---|
| `docs/brain/brain-SESSION-START.md` | Current state, next actions, sequence | Every session, first |
| `docs/brain/brain-PRODUCT-VISION.md` | Full product intent, all three layers, competitive landscape | Product decisions, scope questions |
| `docs/brain/brain-RULES.md` | Build process, git guide, operator preferences, preambles | Build sessions, git operations, agent dispatch |
| `/sources/inspiration/` | Allison's slides and PDF inspiration library | Canvas design sessions, story writing for Layer 2 |
| `/sources/inspiration/CATALOG.md` | Text catalog of all 42 images with pattern analysis | Reference instead of reading images directly |
| `/sources/inspiration/REQUIREMENTS.md` | ~120 user stories extracted from inspiration images | Input for 4-pass user story session |
| `docs/reference/codebase-map.md` | Structured map of R1 codebase | Gap analysis, planning |
| `docs/reference/gap-analysis.md` | Vision vs. codebase — what exists, what needs building | Story writing, planning |
| `~/.claude/plans/expressive-finding-ladybug.md` | Phase 0 Runway build plan (Steps 1-6) | Reference for Runway architecture decisions |
| `/docs/stories.md` | Full user story set (not yet created) | Created during 4-pass session, loaded during /plan |
| `/docs/build-plan.md` | Milestone plan (not yet created) | Created during /plan, referenced in work trees |

---

## §6 Key Decisions (Quick Reference)

Full table in `brain-RULES.md`. The ones that must never be re-litigated:

- **Foundation:** _R1 fork on AI Starter. Not up for re-evaluation.
- **Database:** Turso. Superbase breaks at the work tree step.
- **Canvas elements:** Connected and free-floating are both first-class. No project hook required.
- **Dependency behavior:** Offered to the PM, never automatic.
- **Resourcing model:** Percentage-based, flexible, mixed model. Not task-level hours.
- **This vs. Open Brain:** Separate projects. Do not conflate.
- **One data model, two vocabularies:** Agile and agency are display modes, not separate architectures. 80/20 agency-heavy.
- **Phase 0 is foundation:** Every decision must align with gap analysis. Don't build throwaway.

---

*Session-start status: Updated April 9, 2026. Phase 0 Runway live at runway.startround1.com. PRs #77-#80 merged. PR #81 up (bot v2: thread history, write ops, fuzzy matching, undo, proactive overhaul, prompt caching -- 8 commits, 1213 tests). Next: merge #81, Tim deploys + runs migration, verify bot with Allison and Leslie. Remaining QA sessions: Allison, Ronan, Jason. Update §2 at end of every session.*
