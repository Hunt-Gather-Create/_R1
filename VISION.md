# Vision — Runway

> Civilization Agency's triage board for tracking client work, pipeline, and weekly schedules.
> Designed for the office TV and web access. Phase 0 of the full PM tool.

## What this is

Runway shows everything in flight on one screen:

- This week's calendar (Project tasks with owners/resources by day)
- Project status by account (Client → Wrapper → Project → Task hierarchy)
- Unsigned SOWs in the pipeline

The team updates it via Slack DMs to a bot that uses AI (Claude Haiku) to interpret natural language and write to the database. Claude Code and Open Brain reach the same data through an MCP server. The /runway dashboard renders the result for everyone to see.

## Why this exists

Civilization Agency runs a portfolio of client engagements simultaneously. Before Runway, status lived in spreadsheets, Slack threads, and people's heads. The agency needed:

- **One place to look** — a wall-mounted TV view of "what's happening this week, what's at risk, what's stalled"
- **Friction-free updates** — team members don't have time to log into a PM tool; they message Slack
- **AI-mediated structure** — natural-language updates from non-technical operators get turned into structured rows with audit trail, idempotency, and reversibility
- **Phase 0 foundation** — a runway (pun intended) toward the full PM tool that replaces the agency's Asana/Sheets stack

## What "done" looks like at the project level

Three tiers of "done":

1. **Phase 0 done** — Runway is the office's daily heartbeat. Everyone reads it. Slack updates land cleanly. Data integrity is high enough that the team trusts what they see. Most of the open issue backlog (cascade hardening, modal correctness, dashboard polish) is closed.
2. **Phase 1 done** — Runway becomes the PM tool. Card UX (#9, #10, #11), L3 hierarchy (#39), and Google Sheets integration (#37) ship. The bot's "what's on my plate" experience (#51) is genuinely useful.
3. **Long-term** — Runway is a small piece of a larger Civilization-internal AI platform alongside chat, workspaces, and brand-guidelines extraction (the rest of R1).

## Who uses it

- **Operator** (Jason) — owns the data + the bot. Drives roadmap. Writes prod via data-tp pipeline.
- **Account managers** (Jill, Kathy, Allison) — read the board daily. Submit updates via Slack.
- **Team members** — listed in `team_members` table; surfaced as owners/resources on Project/Task rows.
- **Claude Code sessions** — TP and CC agents reading + writing via MCP, gated by operator approval for prod writes.
- **Open Brain** — agency-internal AI that uses Runway data as context for client decisions.

## What this is NOT

- Not a kanban tool. The `boards`/`columns`/`issues` schema from Tim's upstream is the kanban app; Runway shares the codebase but has its own DB (`RUNWAY_DATABASE_URL`) and routes (`/runway`, `/api/mcp/runway`, `/api/slack/*`).
- Not a multi-tenant SaaS. One agency, one deployment, one shared password gate at `/runway/auth`.
- Not Open Brain itself — Open Brain is a separate Civilization product that reads from Runway.

## Where to look next

- Locked architectural calls → `DECISIONS.md`
- Sequencing of upcoming PRs → `ROADMAP.md`
- Current project snapshot → `STATUS.md`
- Patterns, gotchas, internals → `.claude/MEMORY.md`
- Detailed product/architecture detail → `docs/runway.md`
