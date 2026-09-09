# Schedule sheet authority rules, v1 draft

**Ticket:** `_R1#155`. Milestone M1 of epic `_R1#158`.
**Status:** DRAFT, awaiting operator signature in a comment on `_R1#155`.
**Author:** Runway TP, 2026-09-09.
**Evidence:** four schedules walked by hand with the tool running beside them,
`docs/data-walks/MECHANICAL-VS-HAND-LESSONS.md`. Every rule below cites the run that produced it.

---

## 1. Why this document exists

The operator review sheet has a settled authority rule. Column M is the only cell that can
authorize a write, and a blank cell means no write. That rule is written down, it is enforced, and
three separate failures were traced to bending it.

Schedule sheets have no equivalent. They carry task rows, dates, roles and a status column, and
nothing on them says which rows are safe to act on. So every write the tool proposes today rests on
an unstated rule, and two people reading the same sheet can reasonably disagree about what it
authorizes.

This document is that rule.

## 2. The one line that is easy to get backwards

Both sheets produce no write from a blank cell. They disagree about WHY, and the difference
changes what the tool should report.

On the review sheet, a blank is a **decision**. The operator looked at the row and chose no action.
The correct response is silence. The row closes.

On a schedule sheet, a blank is a **gap**. Nobody decided anything. A missing due date is an
omission in the schedule, not an instruction. The correct response is no write AND a flag, because
somebody needs to know the sheet is incomplete.

Same outcome, opposite meaning. Write it this way and it stays straight: **a blank never
authorizes a write on either sheet. On the review sheet a blank ends the conversation. On a
schedule sheet a blank starts one.**

## 3. What carries authority on a schedule sheet

There is no action column, so authority lives in the row's own shape. A schedule sheet says
"this task exists, it runs from here to here, and this box says whether it is done." Nothing more.
That is the whole grant.

Three consequences follow, and they are the spine of the tables below.

1. **The row class decides whether a write is possible at all.** A section header is not a task. A
   gate is not a span. A spacer is not anything.
2. **A row must be complete to authorize a write.** Incomplete is not a nudge to guess.
3. **The sheet grants authority over the fields it actually carries, and nothing else.** It carries
   titles, dates and a done box. It does not carry people. So the tool can never plan an owner.

## 4. Table A. Row class authority

Row classes are the ones `classify.ts` already produces. This table says what each class may do.
It does not invent a new taxonomy.

| Row class | What it is | Authorized action | Why |
|---|---|---|---|
| `pre-header` | banner rows above the column header | none, ever | not a task row. Read for the project banner only. |
| `column-header` | the row reading checkbox then TASKS | none, ever | it is the contract marker. |
| `section-header` | a phase label, no numeric prefix | none. Carried as the section name for the rows under it. | a phase is a container. Run 2 and run 4 both separated these correctly on their own. |
| `rollup` | the one section header whose dates envelope every leaf | none, ever | it restates the other rows. Writing it would double the board. |
| `milestone` | a gate row, marked with asterisks | none, ever. See rule G1. | a gate is a moment in the plan, not work to schedule. Runs 2, 3 and 4 all found these and skipped them. |
| `leaf` | an indented, numbered task row | one week item, if Table B passes | this is the only class the sheet actually authorizes. |
| `leaf-unnumbered` | indented and dated, no number | one week item, if Table B passes, AND a flag | it is real work, seen on Soundly row 47. It has no stable number, so identity falls back to the title. That is a known hazard and must stay visible. |
| `spacer` | empty title, no dates | none, ever | layout. |
| `empty-template` | empty title but a checkbox or a date present | none. Flag the row. | a half-filled row is a gap, not a task. LPP-2604-02 is 500 of these and the tool correctly read zero tasks from it. |

**Rule G1, gate rows carrying a duration.** The EDF v3 walk on 2026-09-07 found gate rows with
spans, a 23 day design lock and a 2 day dev lock. A gate is a moment. The tool must not collapse
that span to a single date, and must not turn the gate into a task to make the span fit.

Authorized action: **no write, and a flag naming the row, both dates and the span in days.** The
span is real information the schedule is trying to express. Losing it quietly is the failure. This
is a flag and not a hard stop, because a lock window is normal planning and the run should finish.

## 5. Table B. When a leaf row is complete enough to write

Applies to `leaf` and `leaf-unnumbered` only. Every row of this table needs a test.

| Situation | Authorized action |
|---|---|
| Title present, start date parses, due date parses | plan one week item |
| Title present, start date parses, due date blank | **no write.** Flag the row. Do not inherit the section's end date. Do not default to the start date. |
| Title present, start date blank, due date parses | **no write.** Flag the row. |
| Title present, both dates blank | **no write.** Flag the row. |
| Either date present but unparseable | **no write.** Flag the row with the literal cell text. Already the behavior at `parse-sheet.ts:117-124`. |
| Title blank | not a leaf row. Table A handles it. |
| Dates parse but due is before start | **no write.** Flag the row with both dates. A backwards row is a typo, and a tool that silently swaps them hides it. |

**Why no inheriting, ever.** Inheriting a missing date from a section or a neighbor produces a card
that looks correct on the board and matches nothing on the sheet. That is the defect shape this
repo has now counted seven times: working and broken produce the same artifact. A flagged blank
looks wrong on purpose, which is the only reason anyone will fix it.

## 6. Table C. Column authority

Columns are as `parse-sheet.ts:10-22` reads them.

| Column | Label | Role | Authorized use |
|---|---|---|---|
| B | checkbox | intent | the only source of done. TRUE means completed. |
| C | TASKS | intent | the task title, and the indent that classifies the row. |
| D | priority | **not intent** | parsed, carried in notes context, never a write of its own. |
| E | START DATE | intent | start date. |
| F | DUE DATE | intent | end date. |
| G | unlabeled | **operator reserved** | never read, never written, never flagged. |
| H | PREDECESSOR | intent, structural | carried into notes. Does not itself schedule anything. |
| I | LAG | intent, structural | carried into notes UNCHANGED. See rule L1. |
| J | RESOURCE | intent, but not assignable | carried into notes as text. See rule R1. |
| K | STATUS | **derived, never read as intent** | see rule K1. |
| L and beyond | any | **operator reserved** | never read. |

**Rule L1, lag is carried unchanged and is never clamped.** Spilltracker carries a `-1` lag and NFM
fast-tracks four phases the same way. Both are deliberate scheduling, not errors. The parser regex
at `parse-sheet.ts:140` already accepts a negative value, and it must keep doing so. A validator
that clamps a negative lag to zero would produce a plan that looks clean and describes a schedule
nobody wrote.

This is M1's observable event. The proof is a committed parity artifact showing the `-1` carried
through. A clamping build cannot produce that artifact, which is what makes the check real.

**Rule K1, a hand-typed status is protected, not authoritative.** Status is derived from column B.
Run 1 found a hand-typed "On going" in column K, and the tool flagged it. What it should DO was
undefined. The answer:

- The tool never reads column K as the status to write.
- On any row where column K is not empty, the tool plans **no status field for that row**, and
  plans the other fields normally.
- The flag names the row and the literal text.

Reasoning: a person typed into a column the contract says is derived. They were trying to say
something the sheet cannot carry, which is exactly the run 2 finding that the sheet encodes two
states while reality has three. Overwriting them is wrong. Guessing what they meant is worse. Step
around that one field and make the text visible.

**Rule R1, the tool never plans a person.** Column J holds ROLES, not people. Ammonia's column J
reads "Design + Creatives", "Dev + QA", "Account", "BP". Runway's `validateRoleTagOnResources`
needs a role bound to a person, for example "CD: Lane". The sheet does not contain that binding and
cannot be made to.

So `owner` and `resources` are outside the sheet's authority entirely. The tool carries column J
into notes as text and never plans either field. This is already enforced by
`assertToolNeverPlansField` in `parity/compare.ts`, which throws if a payload ever proposes one.
That guard is the enforcement of this rule, and this document is the rule it enforces.

## 7. What this document does NOT decide

Named so nobody reads silence as a ruling.

- **Whether the tool may infer in-progress from the start date versus today.** Run 2 row 13 started
  a week earlier, the box was FALSE, the tool derived `scheduled`, and a person would have written
  `in-progress`. That is a real gap. It is a new rule the operator has to approve, not a bug to fix
  quietly. Out of scope here.
- **Whether derived `category` may be written at all.** Prod carries null on every card the hand
  walks created. The tool derives a value for every row and the comparison does not include the
  field, so ten green rows hid a divergence. That is `_R1#160`, and category is a Runway field, not
  a sheet column.
- **Same-week duplicate title disambiguation.** Identity, not authority. `_R1#153` and `_R1#157`.
- **Whether an L1 belongs as a project or as a week item under an existing project.** The tool
  cannot see the difference and reporting the score honestly is what lets a person tell. Standing
  limit, `_R1#153`.
- **Anything about writing TO a sheet.** The tool is shadow only, operator ruling 2026-09-07.

## 8. Tests owed

One per row, as the ticket requires. Nine rows in Table A, seven in Table B, twelve in Table C,
plus the four named rules. Each test asserts the authorized action and, where the action is a flag,
asserts the flag text names the row.

Two of these need a mutation control rather than an assertion, because a passing test and an inert
test look identical:

- **Rule L1** needs a build with a clamp added, which must fail the test. Otherwise the test only
  proves the current code does not clamp today.
- **Table B, the inherit rows** need a build that inherits, which must fail. A test that a blank
  produces no write passes trivially against code that reads no dates at all.
