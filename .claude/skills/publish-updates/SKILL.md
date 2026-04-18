---
name: publish-updates
description: Publish batched Runway updates to Slack. Generates a draft for review, then posts after user approval.
allowed-tools: Bash(pnpm *), Read, Edit
---

# Publish Updates

Post grouped update summaries to the Slack updates channel. Always generates a draft for user review before posting.

## Step 1: Identify the Batch

If `` contains a batch ID, use it. Otherwise:
- Check if there's an active batchId from a `/batch-update` session
- Ask the user which batch to publish
- Common values: migration filename (e.g., `001-april-14-updates`), or `batch-YYYY-MM-DD`

## Step 2: Generate Draft

Run in dry-run mode (no `--apply`):

```bash
pnpm runway:publish-updates --batch "<batchId>"
```

This writes a draft to `docs/tmp/batch-draft-<batchId>.md` and prints it to stdout.

## Step 3: Present for Review

Read the draft file and present it to the user. Ask if they want to:
- Edit specific lines (remove sensitive items, adjust wording)
- Approve as-is
- Cancel

## Step 4: Apply Edits

If the user requests changes:
1. Edit the draft file at `docs/tmp/batch-draft-<batchId>.md`
2. Show the updated draft for confirmation

## Step 5: Post to Slack

Once approved, post the (possibly edited) draft:

```bash
pnpm runway:publish-updates --batch "<batchId>" --apply --file docs/tmp/batch-draft-<batchId>.md
```

## Step 6: Clean Up

- Confirm the post was successful
- If this was part of a `/batch-update` session, call `setBatchId(null)` to exit batch mode
- The draft file in `docs/tmp/` can be left for reference or deleted
