# What Changed While Runway Was Down (re-grounding) — 2026-08-13

Context: AgencyOS token inefficiency brought the whole system down ~2 weeks ago. It is coming
back on now, programmatic-first, so we can run continuously. This file is the Runway seat's
record of what changed since we (Runway-TP + CC) were last building. It also seeds the generic
onboarding prompt for other dormant projects (e.g. Substrate).

## 1. Programmatic-first + token-efficient (the why)
- Token waste is what took the system down. The fix: codify everything we can into features and
  pipeline. Lean on LLM reasoning only where reasoning is actually required.
- Bias execution reasoning to Sonnet.

## 2. Model routing (locked 2026-08-13)
- Base model for Runway seats (Runway-TP + CC) = Opus.
- WORK runs on subagents explicitly set to Sonnet.
- Keep each subagent task under ~200k context.
- CC plans + codes with Superpowers. Runway-TP plans with CC, dispatches Sonnet subagents.

## 3. Build discipline: Superpowers + GSD
- CC codes using Superpowers.
- Leverage GSD aspects already in our SOPs: the roadmap + phases spine, and the security-check
  for sensitive work.
- Ops briefs Runway-TP on GSD usage.

## 4. Git issues + fleet project board
- Everything visual on the fleet project board.
- Runway-TP builds an EPIC + milestones + tickets following Ops best practices + example set.
- Runway-TP writes tickets for CC. CC self-assigns via a dropdown field (Ops rule) so the board
  shows what CC is working on.
- Goal: clean git + clean git issues, all on the board.

## 5. PR discipline (special: upstream to Tim's R1 origin)
- Runway PRs to upstream (Hunt-Gather-Create:runway) need operator help to land.
- So Runway-TP has special focus: pass Code Review, Preflight (work to diminishing returns),
  then PR Ready, Atomic Commits, strong PR message + ticket best practices.
- Work PR-bot pushback to the point of diminishing returns.

## 6. QA flow
- Runway-TP does QA, leveraging Sonnet subagents.
- When a feature is complete + ready, Holdout QA runs a blind QA pass.

## 7. Runway product direction: the meeting-to-update flow
- A meeting happens with a client. Meeting Processor works the transcripts + summaries.
- Then routing logic decides what should and should not become a Runway update.
- Runway evaluates + updates the Prod DB safely, and the Google Doc Schedules safely, only if
  they pass the logic bars.
- Schedules and Runway Prod DB (and Staging DB) must match in the ways we define.
- This is why the Schedule-integration feature exists. It still has more work.

## 8. DI-TP: role becomes a tool (new milestone)
- DI-TP was treated as a ROLE. It becomes a reusable TOOL that Runway (and others) can call.
- Built reusably: safe + smart DB updates, the Drizzle tool-suite as DRY reusable components,
  following coding best practices.
- Runway Prod/Staging DB have our specifics. Other projects have their own rules and regs, so
  the tool is parameterized per project.
- We should stand up a Staging DB + a defined process for staging and prod.
- Deep research first: how industry / open source handle safe DB updates + staging/prod
  promotion in modern ways that fit our stack (Next.js + Drizzle + Turso/libSQL).
- This is its own milestone, right after the active schedule work.

## 9. Roadmap (epic + milestones, CONFIRMED by operator 2026-08-13)
- EPIC: Runway integration + safe automation.
- M1: Finish Schedule <-> Runway sync (Google Doc schedules and Runway DB stay matched, safely). ACTIVE.
- M2: DB-safety tool (DI-TP role -> reusable tool; Drizzle DRY components; Staging DB + process; deep-research-informed).
- M3: Meeting -> routing -> Runway updates (decide what becomes a Runway update; safe prod + schedule writes on passing logic bars).

## 10. Continuous operation
- We can now run continuously.
