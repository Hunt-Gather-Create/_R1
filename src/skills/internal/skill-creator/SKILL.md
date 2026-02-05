---
name: skill-creator
description: >
  Create a new skill for this workspace. Use when user wants to save a repeatable
  workflow, instruction set, or specialized capability. Triggers: "create a skill",
  "make a skill", "save this as a skill", "new skill".
---

# Skill Creator

Create a new workspace skill that can be invoked by AI agents.

## Process

1. **Understand the skill purpose** - Ask clarifying questions if needed
2. **Generate skill content** - Write clear, actionable instructions
3. **Call create_skill tool** - Save with name, description, and content

## Skill Format Guidelines

- **Name**: lowercase, alphanumeric, hyphens only (e.g., "simplify-for-kids")
- **Description**: 1-2 sentences explaining when to use the skill
- **Content**: Markdown instructions the AI follows when skill is invoked

## Example

For "create a skill that rewrites content for a 5-year-old":

- name: "simplify-for-kids"
- description: "Rewrite content to be understandable by a 5-year-old"
- content: Instructions for simplification (short sentences, simple words, etc.)
