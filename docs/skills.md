# Skills System

Skills are reusable instruction sets that extend the AI assistant's capabilities. They allow you to define specialized behaviors, workflows, and domain knowledge that the AI follows when specific conditions are met.

## Overview

- Skills are stored in the `skills/` directory at the project root
- Each skill is a directory containing a `SKILL.md` file
- Skills are loaded based on workspace purpose (software vs marketing)
- The AI automatically invokes skills when user requests match the skill's triggers

## Directory Structure

```
skills/
├── attach-content/
│   └── SKILL.md
├── aio-geo-optimizer/
│   └── SKILL.md
└── your-new-skill/
    └── SKILL.md
```

## Creating a Skill

### 1. Create the Skill Directory

```bash
mkdir -p skills/your-skill-name
```

Use kebab-case for directory names.

### 2. Create SKILL.md

Create a `SKILL.md` file with YAML frontmatter and markdown content:

```markdown
---
name: your-skill-name
description: |
  Brief description of what this skill does.
  MANDATORY TRIGGERS: keyword1, keyword2, keyword3
  Use when [describe the situations when this skill should activate].
---

# Skill Title

Your skill instructions go here...
```

## Frontmatter Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | No | string | Display name (defaults to directory name) |
| `description` | Yes | string | When the AI should use this skill. Include trigger keywords. |
| `disable-model-invocation` | No | boolean | If `true`, AI won't auto-invoke; user must trigger manually |
| `user-invocable` | No | boolean | If `false`, hidden from manual invocation |
| `allowed-tools` | No | string[] | Tools the AI can use without permission prompts |
| `context` | No | string | Set to `fork` to run in a subagent |
| `purposes` | No | string[] | Limit to specific workspace types: `["software"]` or `["marketing"]` |

## Skill Content

The markdown content after the frontmatter contains the actual instructions. Structure it clearly:

```markdown
# Skill Title

Brief overview of the skill's purpose.

## Workflow

1. **Step One** - Description
2. **Step Two** - Description
3. **Step Three** - Description

## Detailed Instructions

### Section 1

Detailed guidance...

### Section 2

More guidance...

## Output Format

What the AI should produce...
```

## Skill Manifest

Skills are organized by workspace purpose in `src/lib/chat/skills.ts`:

```typescript
const DEFAULT_SKILL_MANIFEST: SkillManifest = {
  common: ["attach-content"],      // Loaded for all workspaces
  software: [],                     // Software development only
  marketing: ["aio-geo-optimizer"], // Marketing workspaces only
};
```

To add your skill to the manifest:

1. Open `src/lib/chat/skills.ts`
2. Add your skill name to the appropriate array:
   - `common` - Available in all workspaces
   - `software` - Software/development workspaces only
   - `marketing` - Marketing workspaces only

## Writing Effective Skills

### Trigger Keywords

Include explicit trigger keywords in the description:

```yaml
description: |
  Generate unit tests for code.
  MANDATORY TRIGGERS: unit test, test coverage, write tests, testing
  Use when the user wants to create tests for their code.
```

### Clear Instructions

Write instructions as if explaining to a capable colleague:

- Be specific about the workflow steps
- Include examples where helpful
- Specify output format expectations
- Note any tools the skill should use

### Tool Integration

Skills can reference available tools:

```markdown
## Tools to Use

- `web_search` - Research best practices
- `attachContent` - Save generated content as a file
- `updateDescription` - Update the issue description
```

## Examples

### Prompt-Only Skill

A skill that provides guidance without special tool usage:

```markdown
---
name: code-review
description: |
  Review code for quality and best practices.
  MANDATORY TRIGGERS: review, code review, check my code
  Use when reviewing pull requests or code changes.
---

# Code Review Skill

When reviewing code, evaluate:

## Code Quality
- Readability and naming conventions
- Function/method length and complexity
- Error handling

## Best Practices
- SOLID principles adherence
- DRY (Don't Repeat Yourself)
- Security considerations

## Output Format
Provide feedback as:
1. **Summary** - Overall assessment
2. **Issues** - Specific problems found
3. **Suggestions** - Improvement recommendations
```

### Task Skill with Manual Invocation

A skill that should only run when explicitly requested:

```markdown
---
name: deploy-checklist
description: Pre-deployment verification checklist
disable-model-invocation: true
---

# Deployment Checklist

Run through this checklist before deploying:

## Pre-Deploy
- [ ] All tests passing
- [ ] No console.log statements
- [ ] Environment variables configured
- [ ] Database migrations ready

## Deploy
- [ ] Create backup
- [ ] Run deployment script
- [ ] Verify health checks

## Post-Deploy
- [ ] Smoke test critical paths
- [ ] Monitor error rates
- [ ] Update status page
```

### Skill with Tool Usage

A skill that generates and attaches content:

```markdown
---
name: technical-spec
description: |
  Generate technical specifications for features.
  MANDATORY TRIGGERS: technical spec, tech spec, specification, architecture doc
  Use when the user needs a detailed technical document.
---

# Technical Specification Skill

Generate comprehensive technical specifications.

## Workflow

1. **Gather Requirements** - Ask clarifying questions
2. **Draft Specification** - Create the technical document
3. **Attach to Issue** - Use `attachContent` to save

## Document Structure

### Overview
- Problem statement
- Proposed solution
- Scope

### Technical Design
- Architecture diagram (describe in text)
- Data models
- API contracts
- Dependencies

### Implementation Plan
- Phases
- Milestones
- Risks

## After Generation

Use the `attachContent` tool to attach the specification:
- Filename: `technical-specification.md`
- Include all sections above
```

## Testing Your Skill

1. Add the skill to the appropriate manifest array in `src/lib/chat/skills.ts`
2. Start the dev server: `pnpm dev`
3. Open a workspace with the matching purpose
4. In the chat, use one of your trigger keywords
5. Verify the AI follows your skill's instructions

## Debugging

If your skill isn't being invoked:

1. **Check the manifest** - Ensure the skill name matches the directory name
2. **Check workspace purpose** - Skills only load for their configured purpose
3. **Check trigger keywords** - Make sure your description includes clear triggers
4. **Check file location** - `skills/<name>/SKILL.md` must exist

To see which skills are loaded, check the server logs or add logging to `loadSkillsForPurpose()` in `src/lib/chat/skills.ts`.

## Best Practices

1. **One skill, one purpose** - Keep skills focused on a single task
2. **Clear triggers** - Include obvious keywords users would naturally say
3. **Structured output** - Define what the AI should produce
4. **Tool awareness** - Reference available tools when relevant
5. **Examples help** - Include examples of expected input/output
6. **Test thoroughly** - Verify the skill works as expected before relying on it

## Related Documentation

- [AI SDK Integration](./ai-sdk.md) - How skills integrate with the chat system
