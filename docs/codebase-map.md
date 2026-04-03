# Codebase Map — _R1

> Generated during Step 3 (INIT), April 3, 2026.
> This is the "what do we already have" reference for gap analysis.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui (New York style), Radix UI primitives |
| Database | Drizzle ORM → SQLite (local) / Turso libSQL (production) |
| Auth | WorkOS AuthKit (SSO, session management) |
| AI | Vercel AI SDK v6 + @ai-sdk/anthropic, default model: Claude Haiku 4.5 |
| Background Jobs | Inngest (serverless, event-driven) |
| File Storage | Cloudflare R2 (S3-compatible, signed URLs) |
| Email | Resend + React Email templates |
| Rich Text | Lexical editor (Meta), CodeMirror markdown editor |
| DnD | @dnd-kit with custom column-aware collision detection |
| Testing | Vitest, @testing-library/react, happy-dom |
| Deployment | Vercel-ready with conditional Turso migrations |

---

## Directory Structure

```
src/
├── app/                        # Next.js App Router
│   ├── api/                    # API routes (chat, attachments, brand, knowledge, skills, audience, dashboard, inngest)
│   ├── w/[slug]/               # Workspace routing (main app)
│   ├── dashboard/              # Dashboard layout
│   ├── login/ callback/ invite/ waitlist/ beta/ profile/
│   ├── layout.tsx              # Root layout (auth, providers)
│   └── globals.css             # Theme vars + global styles
├── components/
│   ├── board/                  # Kanban: BoardView, IssueColumn, AddIssueForm
│   │   ├── context/            # BoardProvider, IssueContext (optimistic updates)
│   │   └── hooks/              # Board-specific hooks
│   ├── list/                   # ListView, ListGroup, IssueRow, ListHeader
│   ├── issues/                 # IssueDetailDrawer, IssueCard, IssueDetailForm, properties/*
│   ├── command/                # CommandPalette (Cmd+K)
│   ├── epics/                  # EpicsDrawer
│   ├── planning/               # AIPlanningSheet, PlanningChatPanel, PlannedIssuesPanel
│   ├── knowledge/              # Knowledge base UI
│   ├── ai-elements/            # ChatContainer, PromptInput, MarkdownContent, ToolResultDisplay
│   ├── layout/                 # AppShell, Sidebar, Header, DisplayPopover
│   ├── workspace/              # Workspace settings, WorkspaceProvider
│   ├── ui/                     # 31 shadcn/ui components
│   └── providers/              # QueryProvider
├── lib/
│   ├── db/                     # schema.ts, index.ts, seed.ts
│   ├── actions/                # 25 server action files (issues, workspace, board, columns, cycles, epics, brand, knowledge, chat, attachments, memories, skills, etc.)
│   ├── hooks/                  # 27+ custom React hooks
│   ├── chat/                   # AI chat utilities, prompt caching, tool definitions, skills system
│   ├── inngest/                # Background job functions (AI task execution, brand research, audience generation, soul generation)
│   ├── ai-search/              # Knowledge base semantic search
│   ├── mcp/                    # Model Context Protocol client (Exa search server)
│   ├── storage/                # R2 upload/download helpers
│   ├── email/                  # Email templates
│   ├── schemas/                # Zod validation
│   ├── types.ts                # TypeScript types (inferred from Drizzle)
│   ├── design-tokens.ts        # STATUS, PRIORITY, VIEW, SHORTCUTS, colors
│   ├── collision-detection.ts  # @dnd-kit column-aware collision
│   ├── filters.ts              # Filter logic
│   ├── query-keys.ts           # React Query key factory
│   ├── auth.ts                 # Auth utilities
│   ├── ai.ts                   # AI model constants
│   └── token-usage.ts          # Cost tracking
scripts/
├── worktree                    # Create isolated git worktrees with deps + migrations
├── worktree-clean              # Clean merged worktrees
├── build-with-migrations.mjs   # Smart Vercel build with conditional migrations
├── generate-invite-codes.ts    # Beta invite code generation
└── migrate-chats-to-r2.ts     # Data migration utility
```

---

## Database Schema (32 tables)

### Core Entities

**users** — synced from WorkOS
- id, email, firstName, lastName, avatarUrl, status (waitlisted|active), role, bio
- AI preferences: aiCommunicationStyle, aiCustomInstructions

**workspaces** (renamed from "boards") — the top-level container
- id, name, slug, identifier (for issue IDs like "AUTO-123"), issueCounter
- purpose (software|marketing), soul (JSON — AI personality config)
- brandId → brands, ownerId → users, primaryColor

**workspaceMembers** — junction: workspace ↔ user
- role: admin | member | viewer

**brands** — user-owned brand identities
- name, tagline, description, summary (AI-generated)
- logoUrl, logoStorageKey, logoBackground (light|dark)
- websiteUrl, primaryColor, secondaryColor, industry
- guidelines (JSON: full brand guidelines), guidelinesStatus

### Issue Management

**columns** — kanban lanes within a workspace
- name, position, isSystem (system columns can't be deleted)
- status: backlog | todo | in_progress | done | canceled

**issues** — the main work item
- columnId → columns, identifier (human-readable "AUTO-123")
- title, description, status, priority (0=urgent → 4=none), estimate (story points)
- dueDate, cycleId → cycles, epicId → epics, assigneeId → users
- parentIssueId (self-reference, 1 level only for subtasks), position
- **AI fields**: aiAssignable, aiInstructions, aiTools (JSON), aiExecutionStatus, aiJobId, aiExecutionResult, aiExecutionSummary, sentToAI

**epics** — planning groups
- title, description, status (active|completed|canceled), dueDate

**cycles** — time-boxed sprints
- name, description, startDate, endDate, status (upcoming|active|completed)

**labels** + **issueLabels** (M2M) — categorization with color

**comments** — issue discussion threads

**activities** — comprehensive audit log (16 activity types: created, updated, status_changed, priority_changed, assignee_changed, label_added/removed, cycle_changed, comment_added, moved, subtask_added/removed, converted_to_subtask/issue, attachment_added/removed)

**attachments** — files on issues (stored in R2)

### AI & Automation

**aiSuggestions** — ghost subtasks proposed by AI (title, description, priority, toolsRequired)

**workspaceSkills** — custom AI skill definitions per workspace (name, description, content, assets, isEnabled)

**workspaceMcpServers** — enabled MCP integrations per workspace (serverKey, isEnabled)

**workspaceChats** + **workspaceChatAttachments** — workspace-level AI conversation threads with generated files

**workspaceMemories** — AI-created contextual memories (content, tags)

**tokenUsage** — tracks AI token consumption per workspace (model, input/output/cache tokens, costCents, source)

**backgroundJobs** — Inngest job tracking (functionId, runId, status, result, error, attempt/maxAttempts)

### Knowledge Base

**knowledgeFolders** — hierarchical folder tree (self-referencing parentFolderId)

**knowledgeDocuments** — markdown docs with: storageKey (R2), previewStorageKey, contentHash, summary (AI-generated), tags

**knowledgeDocumentTags** — extracted #tags for filtering

**knowledgeDocumentLinks** — wiki-link graph between documents (wiki|ticket link types)

**issueKnowledgeDocuments** — junction: issues ↔ knowledge docs

**knowledgeAssets** — images/files embedded in knowledge docs

### Marketing / Audience

**audiences** — target audience groups (generationStatus, generationPrompt, memberCount)

**audienceMembers** — lightweight metadata (name, avatar, age, gender, occupation, location, tagline, primaryPainPoint, primaryGoal, profileStorageKey → full JSON in R2)

### Invitations / Beta

**inviteCodes** — reusable beta invite codes (maxUses, expiresAt)

**inviteCodeClaims** — junction: inviteCode ↔ user

**workspaceInvitations** — email invites with token, role, status, expiry

---

## Server Actions (25 files in src/lib/actions/)

### Auth Pattern
All mutations use `requireWorkspaceAccess(workspaceId, minimumRole?)` — cached per-request via React.cache(). Role hierarchy: viewer(0) < member(1) < admin(2).

### Issue CRUD (issues.ts — 1146 lines)
- createIssue, updateIssue, deleteIssue, moveIssue
- addLabel/removeLabel, addComment/updateComment/deleteComment
- getIssueWithRelations, getIssueComments, getIssueActivities
- Subtask ops: getIssueSubtasks, getSubtaskCount, convertToSubtask, convertToIssue
- AI ops: toggleAIAssignable, updateAITaskDetails, markSentToAI
- **Smart feature**: status change auto-moves issue to corresponding column
- **Subtask rule**: subtasks move with parent, no nested subtasks

### Workspace CRUD (workspace.ts — 785 lines)
- createWorkspace (template-based columns/labels), createCustomWorkspace
- getUserWorkspaces, getWorkspaceBySlug, getWorkspaceById
- updateWorkspace, updateWorkspaceSettings, deleteWorkspace
- inviteMember (3 cases: active user, waitlisted user, non-existent), removeMember, updateMemberRole

### Other Actions
- **board.ts** — getWorkspaceWithIssues (batch queries, no N+1)
- **columns.ts** — CRUD + reorder + orphan column management
- **cycles.ts** — CRUD + activate/complete
- **epics.ts** — CRUD + getEpicProgress
- **brand.ts** — getUserBrands, getBrandById, createBrand
- **knowledge.ts** — folder/document CRUD, sync indexing
- **attachments.ts** — upload initiation, content attachment, deletion (R2-backed)
- **chat.ts** — issue-level chat message persistence (R2 JSON storage)
- **memories.ts** — workspace memory CRUD + LIKE search
- **dashboard.ts** — getDashboardData (batch-optimized), getWorkspaceSummaryContext
- **ai-task-execution.ts** — executeAITask (validates subtask, sends Inngest event), executeAllAITasks
- **background-jobs.ts** — job CRUD, stats, cleanup
- **integrations.ts** — MCP server status with parallel connection tests

---

## API Routes (13+ in src/app/api/)

### Chat Endpoints
- **POST /api/chat** — main workspace chat (tools: web_search, code_execution, web_fetch, skills, memory)
- **POST /api/chat/planning** — decompose features into atomic issues (planIssue, summarizeEpic tools)
- **POST /api/chat/issue** — issue-specific refinement (knowledge context injected, subtask tools)
- **POST /api/chat/workspace** — workspace-level assistant (file creation/reading)

### Other Endpoints
- **POST /api/attachments/upload** + **/confirm** — two-step R2 upload (presigned URL → confirm)
- **POST /api/brand/research** — AI brand research (name search, URL research, screenshot capture)
- **POST /api/dashboard/summary** — AI-generated workspace digest (streaming)
- **POST /api/audience/suggest** — AI audience persona generation
- **POST /api/skills/generate** + **/import** — skill creation
- **GET|POST|PUT /api/inngest** — Inngest webhook (helloWorld, brand research, AI task execution, audience generation, soul generation)
- **POST /api/workspace/soul** — interactive soul configurator (tools: set name, personality, goals, tone, expertise, terminology)

---

## AI Architecture

### Model Strategy
- **Default**: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — used everywhere
- **Prompt caching**: system prompts cached (ephemeral 5-min window), second-to-last message cached — ~90% cost reduction on repeated context
- **Token tracking**: every call logged to tokenUsage table with source tag

### AI Features
1. **Workspace Chat** — general assistant with web search, code execution, file management
2. **Issue Chat** — refine issues, generate subtasks, update descriptions
3. **AI Planning** — decompose features into independent, atomic subtasks
4. **AI Task Execution** — background execution of AI-assignable subtasks via Inngest (max 5 concurrent)
5. **AI Suggestions** — ghost subtasks proposed by AI for user review
6. **Brand Research** — automated guidelines extraction from websites
7. **Audience Generation** — 10 synthetic personas per audience with full profiles
8. **Soul/Persona** — configurable workspace AI personality (name, tone, goals, domain expertise)
9. **Workspace Memories** — AI-created context that persists across chats
10. **Custom Skills** — user-defined prompt templates (lazy-loaded to reduce token cost)
11. **Knowledge Search** — semantic search across workspace documents for context injection

### MCP Integration
- Exa Search server enabled (`https://mcp.exa.ai`)
- Tools merged into chat with namespace prefixing
- Per-workspace enable/disable via database

### Inngest Background Functions
- `ai/task.execute` — AI subtask execution (max 5 concurrent, 1 retry)
- `brand/guidelines.research` — brand guidelines extraction (2 retries)
- `soul/generate` — workspace persona generation
- `audience/members.generate` — 10 persona generation (2 concurrent limit)

---

## Component Architecture

### Provider Hierarchy
```
RootLayout (QueryProvider + TooltipProvider)
  └── AppShell (UI state: currentView, sidebar, detailPanel, commandPalette)
        └── WorkspaceProvider (workspace, members, role)
              └── BoardProvider (issues, columns, labels, cycles, epics + optimistic updates)
                    └── MainContent
                          ├── BoardView / ListView
                          ├── IssueDetailDrawer
                          └── CommandPalette
```

### Data Flow
```
User Action → Component → useOptimistic (instant UI) → Server Action → Database → revalidatePath() → React Query refetch
```

### Views
- **Board** — kanban with @dnd-kit drag-and-drop, custom collision detection
- **List** — table-like with sorting, grouping, multi-select, keyboard navigation
- **Timeline** — referenced in design tokens but implementation unclear

### Key UI Components (31 shadcn/ui + custom)
- Issue properties: StatusSelect, PrioritySelect, AssigneeSelect, LabelSelect, DatePicker, EstimateInput
- AI elements: ChatContainer, PromptInput, MarkdownContent, ToolResultDisplay
- Planning: AIPlanningSheet (two-panel: chat + planned issues)
- Knowledge: folder tree, document editor, wiki-links
- Epics: EpicsDrawer with progress tracking

### Custom Hooks (27+)
- Board/data: useBoardQuery, useURLState
- Mutations: useCreateIssue, useUpdateIssue, useDeleteIssue, useMoveIssue, etc.
- AI/Chat: useChatCore, useAISuggestions, useExecuteAITask, useSoulChatMessages
- Knowledge: 15+ hooks for knowledge CRUD
- Utilities: useColorMode, useMounted, useSendToAI, useServerSearch

---

## Design Tokens (src/lib/design-tokens.ts)

| Token | Values |
|---|---|
| STATUS | backlog, todo, in_progress, done, canceled (each with label, colors) |
| PRIORITY | urgent(0), high(1), medium(2), low(3), none(4) (each with label, colors, icon) |
| VIEW | board, list, timeline |
| GROUP_BY | status, priority, label, cycle, epic, none |
| SHORTCUTS | Cmd+K (palette), C (create), P (plan), / (search), G+B (board), G+L (list), [ (sidebar) |
| WORKSPACE_PURPOSE | software, marketing, sales, custom (each with default columns/labels) |
| COMMUNICATION_STYLES | precise, friendly, casual, formal, technical |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| WORKOS_CLIENT_ID, WORKOS_API_KEY, WORKOS_COOKIE_PASSWORD | Auth |
| NEXT_PUBLIC_WORKOS_REDIRECT_URI | OAuth callback |
| TURSO_DATABASE_URL, TURSO_AUTH_TOKEN | Production database (optional — falls back to local SQLite) |
| R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME | File storage |
| CLOUDFLARE_DOC_CONVERTER_URL, ...TOKEN, ...TIMEOUT_MS, ...FILE_FIELD | Office→PDF conversion |
| SMITHERY_API_KEY | Brand research |
| RESEND_API_KEY | Email |
| APP_URL | Base URL |
| INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY | Background jobs (production only) |

---

## What Exists vs. What Round One Needs (Quick Reference)

### Exists and Usable
- Full issue/workspace CRUD with optimistic updates
- Kanban board + list views with DnD
- Subtask system (1 level deep)
- Epic grouping and cycle/sprint management
- Activity audit trail
- User auth + workspace membership + invitations
- AI chat (workspace, issue, planning levels)
- AI subtask execution (background, via Inngest)
- Brand system with guidelines extraction
- Knowledge base with wiki-links and AI search
- Token usage tracking
- File attachments (R2)
- Custom AI skills system
- MCP integration (Exa search)
- Design tokens for status/priority/views

### Does Not Exist (Relevant to Round One Vision)
- **Canvas layer** — no canvas, no visual storytelling, no free-form element placement
- **Narrative connectors** — no line-drawing or connector tools
- **Per-client brand palette theming** — brands exist but not as view-level art-tool themes
- **Dependencies** — no task-to-task dependency model in Layer 1
- **Timeline/Gantt view** — referenced in tokens but not implemented
- **Resource/capacity view** — no resourcing layer
- **Multi-view types** (strategic roadmap, process diagram, waterfall, content calendar, text matrix, portfolio timeline) — none exist
- **Template/stamp system** — no repeating pattern templates
- **Zoom hierarchy** (roadmap → project → phase → countdown) — not implemented
- **Connected vs. detached element spectrum** — no concept of data-connected vs. free-floating elements
- **Ripple effect** — no layout engine for graceful re-composition when base data changes
- **Phase 0 TV display** — no read-only dashboard/display mode
- **Phase 0 password-protected web view** — no public share with auth
