# opeff#1122 charter rewrite, survival table v2, G2_BOUNCE redo against the real upstream base

## Base choice, documented per the bounce ruling

The first pass of this ticket built the new `CLAUDE.md` against `origin/runway` at 05d9567, a
261-line file, because that bot clone's `origin` remote pointed at the fork, `jasonburks23/_R1`,
not the real trunk, `Hunt-Gather-Create/_R1`. Gate-2 bounced on base, not content: the branch was
44 files behind the real trunk, and the real trunk's `CLAUDE.md`, at 7d3e222, is 213 lines, not
the 261-line fork copy this table was built against.

Rebuilding against 7d3e222 surfaced a second problem before any conflict resolution started:
upstream's 213-line `CLAUDE.md` is not the old, un-rewritten file.
Someone already landed an independent rewrite of it in the same 44-file gap, with its own
orientation doc, `docs/runway/tp-orientation.md`, and its own git-hooks doc,
`docs/runway/git-hooks-sop-reference.md`, both already populated. Flagged to Ops before touching
the file; ruling received:

- Upstream's rewrite is the base, since it is already live on the trunk.
- This branch's content layers on top only where it adds substance upstream lacks.
- Reuse upstream's `docs/runway/tp-orientation.md` as the orientation doc; this branch's
  `docs/standards/runway-orientation.md` is dropped, its content folded into the upstream doc
  where upstream did not already carry it.
- Keep upstream's hygiene-guard config steps and worktree-removal rule; they are rules, not
  history, so they stay in `CLAUDE.md` core, not the orientation doc.
- Match this branch's eight-heading WS1 order in the final `CLAUDE.md`, since upstream's own
  order differs from the standard and the fleet health check reads section order. Gate-1 caught
  a wording slip here: an earlier draft of this table and the dev's own report both said "nine
  sections", but the "own" and "not own" sections are merged into one heading, "What you own,
  what you do not own", matching the Overwatch exemplar, so the core body has eight `##` headings,
  not nine. Corrected per the second bounce.
- Two-block survival table: block 1 traces upstream's 213 lines, block 2 catches any sentence
  the 261-line fork copy carried that upstream's independent rewrite dropped, so nothing the fork
  carried vanishes silently.
- Mirror block stays byte-identical to opeff main.

Method for block 1: upstream's prose is terser than the fork copy and does not always split into
one clause per line, so this block traces by content block, heading or paragraph or table,
against upstream's `CLAUDE.md` at 7d3e222 line by line, same three verdicts as before, KEPT in
the new `CLAUDE.md`, MOVED to `docs/runway/tp-orientation.md` with a pointer, or DROPPED with the
policy reason.

## Block 1, upstream's 213-line CLAUDE.md at 7d3e222

| Upstream lines | Content | Verdict | Where it lives now |
|---|---|---|---|
| 1 | Title, `# CLAUDE.md: Runway (TP) navigation map` | KEPT, retitled | New title, `# CLAUDE.md: Runway TP role charter`, matches this branch's naming, unchanged from the first pass |
| 3 | What Runway is, the platform, the pitch pointer | KEPT, condensed | Who you are |
| 5 | "This file holds only the load-bearing rules... Lessons live in Hemingway" framing | KEPT, condensed | Title intro; the Hemingway pointer moved to Memory substrate |
| 7-23 | "Where to look for what" navigation table, 13 rows including the new git-hooks row upstream added | MOVED | Orientation, new "Navigation map" section, all 13 rows carried including the git-hooks row and the "reasoning behind any rule" row |
| 25-43 | Commands fenced block, including upstream's new `pnpm build` safety comment about two live Turso databases | MOVED | Orientation, new "Commands" section, upstream's safety comment on `pnpm build` preserved verbatim |
| 47-54 | Git section: trunk D-06, one-branch-per-ticket lifecycle, operator-merges and never-push/force-push/--no-verify, new-checkout hooks install and certify, Fixes-keyword close-by-hand, worktree removal via `git worktree remove --force` | KEPT, this is new rule content upstream added since the fork diverged | Core operating principle 1, expanded from the first pass to carry the hygiene-guard steps and worktree-removal rule per the bounce ruling; branch naming pattern, `fix/<issue>-...` etc, present at old fork line 51 and upstream line 50, folded in too |
| 56-64 | Post-build pipeline, 7 numbered steps | MOVED | Orientation, "Post-build pipeline" section, upstream's trimmed step list carried as-is |
| 66-73 | Roles and safety: TP/CC split, D-10 prod writes, new `runway-auto-promote.ts` and `runway:migrate --apply` danger note, tests woven in, plan-mode and AskUserQuestion restriction with fence-operator.sh detail, new credential-printing rule naming BUZZ_PRIVATE_KEY and buzz-send.sh | KEPT, condensed, this block carries real new safety content upstream added | Core operating principles 2 and 3; the credential-printing rule folded into Comms discipline, Transport, since it is a comms-channel rule in this branch's structure |
| 75-79 | AI: product-runtime Haiku default D-05, prompt caching, cap-the-loop with stopWhen not maxUses | KEPT, condensed, detail MOVED | Core operating principle 4; full maxUses/#34 explanation already in orientation's existing "Capping the agent loop" section, untouched |
| 81-88 | Dispatch default-to-standing-seat, chase to ACK, work/seat/room table | KEPT, condensed | Core operating principle 7 carries the ACK rule; Dispatch routing carries the work/seat table pointer |
| 90-96 | Seat table, the source of truth line, pubkey and room rows | DROPPED, same policy call as the first pass | Superseded by the WS1 standard's registry-is-source-of-truth rule; `etc/fleet-seat-registry.json` pointer in Dispatch routing. Flagged here again since upstream's own rewrite reintroduced the raw table that the WS1 standard says should not live in a seat's CLAUDE.md |
| 98 | CC room vs Overwatch room distinction, `--mention` needs full hex | KEPT, condensed | Dispatch routing bullet 3; Comms discipline, Transport |
| 100-106 | "Rules of the room": CC serial, one thread per ticket, fire QA in-thread, never give QA-Scout-1 a build, envelope header states, bot-liveness proof | KEPT, condensed, detail MOVED | Core operating principles 6, 8, 9; Dispatch routing bullets; full detail already in orientation's "How to actually run the room" section |
| 108 | Chain: CC builds through Holdout closes, now naming Holdout's scope as "credentials, protocol, and deliverable shapes" | KEPT, this phrase is new since the fork and is more precise than the fork's plain "Holdout blind gate-2" | Core operating principle 6, upstream's more specific Holdout-scope wording carried forward |
| 110 | Exception conditions for a standing-seat default | KEPT, condensed | Dispatch routing bullet 1 |
| 112-114 | Reporting line: Overwatch is the only upward channel, three enforced limits | KEPT, condensed | Topology |
| 116-118 | Memory substrate: Hemingway search-by-title-words, load hemingway-write before a write, local MEMORY.md/DECISIONS.md, new "no TP-STATE file, native compaction carries the thread" line | KEPT, this is new content since the fork | Memory substrate, upstream's newer detail about no TP-STATE file carried forward |
| 120-122 | Plan execution pointer | KEPT, condensed | Repo setup and pointers |
| 125-169 | Mirrored session-dialogue block | KEPT, byte-diffed | Confirmed identical in substance to opeff main's current copy; upstream's own copy here is stale, it still carries two parenthetical asides opeff main already dropped. The new CLAUDE.md's mirror is copied from opeff main directly, not from upstream's stale copy, so it is current, not merely matching upstream |
| 173-198 | Model tiering for delegated work, the global block | DROPPED, same reason as the first pass | Duplicate of the global `~/.claude/CLAUDE.md` content, not seat-specific, absent from both original exemplars, opeff and agencyos-overwatch. Upstream's own rewrite kept this block; this branch overrides that choice to hold the 150-line cap, which upstream's 213-line file does not meet |
| 202-213 | Reading another seat's CLAUDE.md, quote-not-copy block | DROPPED, same reason | Same duplicate-of-global reasoning as above |

## Block 2, sentences the 261-line fork copy carried that upstream's rewrite dropped

Checked every block of the old fork file at 05d9567 against upstream's `CLAUDE.md`,
`docs/runway/tp-orientation.md`, and `docs/runway/git-hooks-sop-reference.md`. One block is
genuinely absent from all three; everything else the fork carried is present somewhere upstream,
sometimes trimmed in wording but not gone.

| Old fork content | Present upstream? | Verdict | Where it lives now |
|---|---|---|---|
| "Dev seat model routing, Runway-TP plus CC": base session runs Opus and orchestrates only, building and analysis run on Sonnet, Sonnet 4.6 is the ceiling, ~200k context per task, never Haiku for judgment work, locked 2026-08-13, pointer to `docs/planning/whats-changed-2026-08-13.md` | Absent from upstream `CLAUDE.md`, `tp-orientation.md`, and `git-hooks-sop-reference.md`; confirmed by grep for "Opus", "Sonnet 4.6", and the pointer doc's filename across all three | KEPT, restored | Core operating principle 5. This is live fleet policy governing which model this seat and CC run on, distinct from the product-runtime AI cost control, D-05, and from the global model-tiering-for-delegated-work block; its detail doc still exists in the upstream tree, so it is not stale. Upstream's rewrite dropped it without a pointer and that is treated as an omission, not a deliberate policy reversal, since no reasoning for dropping it appears anywhere upstream |
| All other fork-only wording, e.g. the old file's more verbose gloss on each post-build pipeline step, the "relay plus an attestation about the relay is still a relay" line, the "why this is here and not memory" framing, the reporting-line conflict history, the bot-liveness proof detail | Present upstream, in `tp-orientation.md`, sometimes trimmed | KEPT or MOVED, no action needed | Confirmed present in upstream's own orientation doc at the lines cited in block 1 above; not duplicated here since block 1 already traces them from the upstream side |
| Old fork line 100: "All three verified 2026-08-27 with `buzz channels members --channel 46290a49-...`... Re-verify from that command, never from memory or from another seat's copy." Gate-1 caught this on the second pass, it was silent here on the first bounce's redo | Present upstream, `tp-orientation.md`'s dispatch-routing-why section, but with the 2026-08-27 verification date dropped; the re-verify instruction and the exact command survive verbatim | DROPPED, named here, the date only | A dated one-time verification stamp, not a rule; the load-bearing instruction is "re-verify from that command, never from memory", which upstream's rewrite kept. The date itself has no ongoing force once the seat table it verified is gone from `CLAUDE.md` in favor of the registry pointer, see the fix logged just below |

## Content this branch added beyond upstream's orientation doc

Reused `docs/runway/tp-orientation.md` as instructed and appended three sections upstream's copy
lacked, each carried over from this branch's now-dropped `docs/standards/runway-orientation.md`:
"Navigation map" and "Commands", both needed because upstream's `CLAUDE.md` puts this content in
core while this branch's eight-heading order does not have a slot for it there, so it moves to
orientation; and "Post-build pipeline", same reasoning. Also appended "Memory rules, this repo's
local knowledge store", the Scripts/Patterns/Gotchas heading convention, which upstream's rewrite
trimmed to one line in `CLAUDE.md` itself and did not carry into its orientation doc at the same
level of detail as the fork copy had it.

## Net effect

New `CLAUDE.md`: 150 lines, at the standard's cap, upstream's own 213-line copy was over it.
`docs/runway/tp-orientation.md`: upstream's 55-line file plus 4 new sections, navigation map,
commands, post-build pipeline, and the memory-rules heading convention. This branch's
`docs/standards/runway-orientation.md` and its content are retired, superseded by the reused
upstream doc per the bounce ruling. One restored rule, block 2's dev-seat model routing
principle, that upstream's independent rewrite had silently dropped.

## Second gate-1 bounce, two fixes

Gate-1 read the second pass clean on base, coverage, the restored routing rule, the Runway rules,
mirror, and count, then caught two small things. One, load-bearing: `tp-orientation.md`'s
dispatch-routing-why section still said "The seat table in CLAUDE.md is the source of truth for
the three pubkeys and the room", a sentence this branch's own edit to `CLAUDE.md` made false,
since the table moved out in favor of the registry pointer back on the first pass. Reworded to
name `etc/fleet-seat-registry.json` at agencyos-operational-efficiency as the source of truth,
kept the re-verify command unchanged. Two: block 2 above was silent on the old fork's
2026-08-27 verification date at old line 100, now added as a named drop. Also corrected this
table's own "nine-section" wording to "eight" throughout, since "What you own, what you do not
own" is one merged heading, matching the Overwatch exemplar, not two.
