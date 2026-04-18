---
name: batch-update
description: Enter batch update mode — all changes are tagged with a batchId and Slack notifications are suppressed until you publish.
---

# Batch Update Mode

Enter batch mode for making multiple Runway data changes without flooding the Slack updates channel. Changes are tagged and published as a single grouped message when done.

## Step 1: Initialize

Generate a batchId for this session:
```
batch-YYYY-MM-DD
```

Call `setBatchId(batchId)` via the MCP `set_batch_mode` tool or directly in code.

## Step 2: Load Context

Read the current state before making changes:
- `get_clients` — all clients
- `get_projects` — all projects with current field values
- `get_week_items` — current week's calendar
- `get_pipeline` — pipeline items
- `get_team_members` — team roster

## Step 3: Make Changes

Use the operations layer directly for all changes. Available operations:

**Projects:** `updateProjectField`, `deleteProject`, `updateProjectStatus`, `addProject`
**Week Items:** `createWeekItem`, `updateWeekItemField`, `deleteWeekItem`
**Pipeline:** `createPipelineItem`, `updatePipelineItem`, `deletePipelineItem`
**Clients:** `updateClientField`, `createClient`
**Team:** `createTeamMember`, `updateTeamMember`

### Ground Rules

- Use the MCP tools with batch mode active (`set_batch_mode`). Slack notifications are automatically suppressed.
- All changes are automatically tagged with the batchId in audit records
- Log what you're doing clearly so the user can follow along

## Step 4: Finish

When the user says "done", "publish", or "ship it":

1. Invoke `/publish-updates` to review and post the changes
2. Call `setBatchId(null)` to exit batch mode

If the user wants to abort without publishing:
1. Call `setBatchId(null)`
2. The changes are already in the database but won't be announced to Slack
