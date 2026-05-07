# Escalation criteria

When to decide and log vs escalate to operator. Per session, you'll make dozens of judgment calls — most are reversible and within-pattern. The ones that aren't are what operator needs to see.

## The matrix

| Scenario | Confidence | Action |
|---|---|---|
| Reversible decision, in-pattern, ≥70% confidence | high | Decide. Log with reasoning. Operator audits async. |
| Reversible decision, novel pattern (not in skill or cohort precedent) | any | Escalate. Novel patterns are how the skill grows. |
| Reversible decision, <70% confidence | low | Escalate, even if reversible. Low confidence = high risk of compound error. |
| Irreversible (pre-APPLY, skill landing, worktree dispose) | any | Escalate, always. These are operator gates. |
| High blast radius (wrappers, parent-child structure, cascade behavior, idempotency keys) | any | Escalate, even if confident. Cost of being wrong is high. |
| GREEN verdict with no flags | high | Just relay. No escalation needed. |
| YELLOW with hygiene amendments | high | Decide on the amendment, communicate to data-tp directly via signal file. |
| RED — structural issue or factual error | high | Escalate immediately. Halt the batch. |

## Confidence calibration

Confidence is a self-report. You're estimating how often "you'd be right if you decided this way" across a hundred similar calls.

Rough anchors:

- **95-100%**: textbook case, exactly matches a pattern you've seen many times. "This is a paired startDate write — yes, the spec is correct."
- **80-95%**: pattern match with one or two minor variations. "This handoff doc cohort table follows the same shape as Soundly's, with 3 new rows for Cgx-only categories."
- **70-80%**: pattern match but a novel piece. "Skill v4 #25 is the first time we've seen parent-recompute clobber, but the proposed text is grounded in today's evidence."
- **50-70%**: judgment call, multiple defensible answers. "Should #20 evidence be tightened to one bullet or could keep both?" → escalate.
- **<50%**: don't know. Escalate. Don't guess.

When in doubt, the cost of escalating is low (one ping to operator). The cost of a wrong autonomous call may be high. Bias toward escalation when the call feels close to 70%.

## Reversibility classification

| Class | Examples | Decide-and-log threshold |
|---|---|---|
| **Fully reversible** | Cross-check verdict wording, doc structure suggestions, snapshot interpretation, hygiene amendments | ≥70% confidence |
| **Hard to reverse** | Operator escalation framing (once raised, can't unraise without bias), skill v4 patch GREEN/YELLOW/RED that influences operator's review session | ≥85% confidence |
| **Irreversible** | Pre-APPLY greenlight, skill text landing, worktree disposal | Always escalate |

"Hard to reverse" matters because operator's calibration depends on you not pre-biasing them. If you stamp a patch RED prematurely, operator may dismiss it without their own review.

## Blast radius rules

Some areas of the data model have outsized consequences if cross-check is wrong. Escalate any judgment call touching these regardless of confidence:

- **Retainer wrappers** — wrapper guard violations corrupt parent-child relationships across an entire client's project tree
- **parentProjectId writes** — orphan creation, cycle creation, cross-client parenting all break the model
- **Cascade behavior** — recompute clobbers, reverse-cascade traps, idempotency key collisions all silently lose data
- **Audit log integrity** — anything that affects `find_updates` results affects future verification
- **Idempotency keys** — wrong `updatedBy` after revert poisons retry, silent skip on next attempt

For these, the standard is "operator sees the call, even if I'm 95% confident." Independent eyes catch what one set misses.

## Examples from prior sessions

### Decide-and-log (correct calls)

- "data-tp's snapshot has malformed IDs in notesDedupesApplied — recommend normalizing to 8-char short form. Confidence: 95%. Reversibility: full. Reasoning: clear convention violation, drafter likely autocompletion artifact."
  - Decided: flag as hygiene, not blocking. Logged.
- "Convention sweep CAT 1-8 evidence claim in v4 patch #20 doesn't match triplet — verified by reading spec line 81 + triplet lines 257-281. Confidence: 99%. Reversibility: hard. Reasoning: factual claim is incorrect, ground truth is on disk."
  - Decided: flag as YELLOW for tightening before operator review. Logged.

### Escalate (correct calls)

- "Operator-stated decision was Flag 1 = B (single-day milestone), but spec implies Flag 1 = A (multi-day window) on CAT 1-8. Could be either; operator's actual intent ambiguous from current evidence."
  - Escalated. Operator clarified Flag 1 = B.
- "Skill v4 #25 is critical, but I haven't seen a parent-recompute clobber pattern before — first occurrence in cohort. Confidence on severity classification: ~70%."
  - Escalated for operator confirmation that CRITICAL classification is right.

### Decide-and-log (hypothetical wrong calls)

- "data-tp's spec uses parentProjectId=null on a wrapper child. I think this is intentional cleanup. Confidence: 75%. Reversibility: hard."
  - Wrong — parent-child structure changes are blast-radius escalations regardless of confidence. Should have escalated.

### Escalate (hypothetical wrong calls)

- "data-tp's snapshot has a typo in a comment. Should I fix?"
  - Wrong — fully reversible, low blast radius, ~99% confidence. Should have flagged as hygiene and moved on. Operator doesn't need to see typo escalations.

## Decision log file

Append to `docs/tmp/data/evaluator-decisions-<YYYY-MM-DD>.md` in the worktree.

Per-entry format:

```markdown
## <ISO timestamp> | <decision class> | confidence: <0-100%>

**Context:** <one line — what artifact, what call>
**Decision:** <what you chose>
**Reasoning:** <one or two sentences>
**Reversibility:** <reversible / hard-to-reverse / irreversible>
**Blast radius:** <low / medium / high>
**Operator audit:** <pending / confirmed / corrected>
```

When operator reviews, they edit `Operator audit:` to `confirmed` or `corrected`. Corrected entries become learnings.md candidates and may mature into template additions.

## Audit feedback loop

The decision log is how the skill grows.

- **Confirmed entries** raise your confidence threshold for similar calls in future sessions (you can decide-and-log on more, escalate less).
- **Corrected entries** become skill-patch candidates. The pattern of "I called X, operator said Y" is exactly the data the skill needs to learn from.
- **Pending entries** that operator never gets to are signal that the audit cadence isn't keeping up — surface to operator, request a batch review.

## When the matrix doesn't fit

If you're holding a judgment call that doesn't cleanly map to the matrix — escalate. The matrix is for routine calls; novel categorization is itself a learning signal.
