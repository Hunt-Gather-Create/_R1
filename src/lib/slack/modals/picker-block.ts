/**
 * Shared multi-match candidate picker block builder for the Slack modal flows.
 *
 * Wave 7 / Fix 7.1: the picker block construction was triplicated across
 * task.ts, project.ts, and team-member.ts. Three different constant names for
 * the same Slack caps (option-array max 100, option-text max 75), three
 * implementations of the last-8-char id-suffix description, three nearly
 * identical block-shape literals. The label text was the only meaningful
 * difference per kind.
 *
 * This module collapses that into one builder + one set of constants. Each
 * per-kind builder now imports `buildMultiMatchCandidatePicker` directly and
 * passes its kind. The output shape matches the prior triplicated builders
 * 1:1, so existing assertions in task.test.ts / project.test.ts /
 * team-member.test.ts continue to pass without modification.
 *
 * Civ voice: ASCII hyphens only, no em-dashes.
 */

// ---------------------------------------------------------------------------
// Slack hard caps
// ---------------------------------------------------------------------------

/**
 * Slack `static_select` option text caps at 75 chars. Longer labels get
 * truncated to 72 chars + "..." so the option still surfaces an identifying
 * prefix.
 */
export const SLACK_OPTION_LABEL_MAX = 75;

/**
 * Slack `static_select` accepts at most 100 options in the `options` array.
 * Larger candidate lists get sliced to the first 100; the slash-command flow
 * surfaces a "Showing the first 100" hint to the user via
 * `formatEditMultiMatchHint(..., { truncated: true })`.
 */
export const SLACK_STATIC_SELECT_OPTIONS_MAX = 100;

// ---------------------------------------------------------------------------
// Per-kind label + placeholder strings
// ---------------------------------------------------------------------------

const PICKER_LABELS = {
  task: {
    label: "Tasks matching your search",
    placeholder: "Pick the task to edit",
  },
  project: {
    label: "Projects matching your search",
    placeholder: "Pick the project to edit",
  },
  "team-member": {
    label: "Team members matching your search",
    placeholder: "Pick the team member to edit",
  },
} as const;

export type PickerKind = keyof typeof PICKER_LABELS;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the static_select input block that surfaces the multi-match candidate
 * list during /runway-edit-{task,project,team-member} disambiguation. Picking
 * an option fires a block_actions event (`dispatch_action: true`,
 * `action_id: "multi_match_candidate_select"`) which the interactivity
 * handler uses to load the picked entity and re-render the modal with
 * `currentValues` populated; at that point the per-kind builder suppresses
 * this block.
 *
 * Output shape contract (asserted by sibling builder tests):
 *   - type: "input"
 *   - block_id: "multi_match_candidate_block"
 *   - dispatch_action: true
 *   - label.text: per-kind from PICKER_LABELS[kind].label
 *   - element.type: "static_select"
 *   - element.action_id: "multi_match_candidate_select"
 *   - element.placeholder.text: per-kind from PICKER_LABELS[kind].placeholder
 *   - element.options: Slack option array, capped at SLACK_STATIC_SELECT_OPTIONS_MAX,
 *     with each entry's text capped at SLACK_OPTION_LABEL_MAX (truncated to
 *     `${cap-3} chars + "..."`) and an id-suffix description ("...XXXXXXXX",
 *     last 8 chars of the id; or `...{id}` when the id is 8 chars or shorter).
 */
export function buildMultiMatchCandidatePicker(
  kind: PickerKind,
  candidates: ReadonlyArray<{ id: string; label: string }>,
): Record<string, unknown> {
  const { label, placeholder } = PICKER_LABELS[kind];
  const options = candidates.slice(0, SLACK_STATIC_SELECT_OPTIONS_MAX).map((c) => {
    const truncatedLabel =
      c.label.length > SLACK_OPTION_LABEL_MAX
        ? `${c.label.slice(0, SLACK_OPTION_LABEL_MAX - 3)}...`
        : c.label;
    // Wave 6 / Fix 6.6: when two candidates share a 72-char prefix the labels
    // render identically. Surface the last 8 chars of the entity id as
    // `description` so the picker is self-disambiguating.
    const idSuffix = c.id.length > 8 ? `...${c.id.slice(-8)}` : `...${c.id}`;
    return {
      text: { type: "plain_text" as const, text: truncatedLabel, emoji: false },
      value: c.id,
      description: { type: "plain_text" as const, text: idSuffix, emoji: false },
    };
  });

  return {
    type: "input",
    block_id: "multi_match_candidate_block",
    dispatch_action: true,
    label: { type: "plain_text", text: label, emoji: false },
    element: {
      type: "static_select",
      action_id: "multi_match_candidate_select",
      placeholder: { type: "plain_text", text: placeholder, emoji: false },
      options,
    },
  };
}
