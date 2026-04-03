# Gap Analysis — Vision vs. Codebase

> Generated during Step 4, April 3, 2026. Updated same day with architectural decisions from gap review conversation.
> Inputs: `brain-PRODUCT-VISION.md`, `/docs/codebase-map.md`, `/sources/inspiration/REQUIREMENTS.md`, `/docs/agile-vs-agency-pm.md`
> Output feeds directly into the 4-pass user story session (Step 5).

---

## How to Read This

Each section covers a vision requirement. For each:
- **Vision says** — what the product needs
- **Codebase has** — what exists today
- **Verdict** — one of: `EXISTS` (use as-is), `EXTEND` (modify existing), `BUILD` (from scratch), `CONFLICT` (existing code works against the vision)
- **Notes** — implementation considerations

---

## Phase 0: Agency Dashboard / TV Display

### P0-1. Real-time TV display of everything in flight

| | |
|---|---|
| **Vision says** | Screen on the main floor TV showing all active work, auto-updating. Large type, clear color coding, readable at a distance. Day/week/month filters. |
| **Codebase has** | Nothing. No read-only dashboard mode, no public display route, no auto-refresh mechanism beyond React Query polling. |
| **Verdict** | **BUILD** |
| **Notes** | New route (`/display/[token]` or similar). Needs: polling or SSE for live updates, large-type responsive layout, simplified navigation for trackpad interaction. Can reuse React Query + existing server actions for data fetching. Design is "operations dashboard, not PM interface." |

### P0-2. Password-protected web view

| | |
|---|---|
| **Vision says** | Same data as TV display, behind a login. Accessible from any device. |
| **Codebase has** | WorkOS auth exists. Workspace membership with role system (admin/member/viewer) exists. |
| **Verdict** | **EXTEND** |
| **Notes** | Could use viewer role or a separate simple auth (password-only, no WorkOS account needed). The workspace data fetching (`getWorkspaceWithIssues`, `getDashboardData`) already exists. Needs a new simplified UI layer on top of existing data. |

### P0-3. Trackpad interaction on TV

| | |
|---|---|
| **Vision says** | Trackpad near TV for changing views, drilling in. |
| **Codebase has** | Standard mouse/keyboard interaction. |
| **Verdict** | **BUILD** (minor) |
| **Notes** | UI/UX concern — large click targets, swipe gestures, no hover-dependent interactions. Not a separate feature, just a design constraint on P0-1. |

---

## Layer 1: Core Project Management

### L1-1. Client → Project → Phase hierarchy

| | |
|---|---|
| **Vision says** | A client has multiple projects. A project has multiple phases running concurrently or sequentially. Agency portfolio view sees all of it. |
| **Codebase has** | **Workspaces** (top-level container) with issues, columns, epics, cycles. **Brands** exist as client identity objects. No explicit "client" entity that groups multiple workspaces. No "phase" entity distinct from epics. No multi-workspace portfolio view. |
| **Verdict** | **BUILD + EXTEND** |
| **Notes** | Need: `clients` table (or repurpose brands), explicit client→workspace relationship, `phases` as a first-class entity (distinct from epics — phases are timeline-bound containers for tasks, epics are planning groups). Portfolio view queries across workspaces. This is foundational — most of Layer 2 and Layer 3 depend on this hierarchy existing. |

### L1-2. Task dependencies with cascade

| | |
|---|---|
| **Vision says** | Dependencies cascade. When a date moves, the system calculates downstream impact and *offers* it to the PM. PM decides: cascade everything, adjust manually, or mix. Never automatic. |
| **Codebase has** | **No dependency system at all.** Issues have parent-child (subtasks, 1 level) but no task-to-task dependency relationships. No dependency types (FS, SS, FF, SF). No cascade logic. |
| **Verdict** | **BUILD** |
| **Notes** | Need: `dependencies` table (sourceIssueId, targetIssueId, type, lag), cascade calculation engine (compute downstream impact graph), confirmation UI ("these 12 tasks would shift — apply all, pick, or skip?"), undo integration. Vision explicitly says "offered, not automatic." |
| **DECIDED** | All 4 types supported (FS, SS, FF, SF). FS is the easy default; SS/FF/SF behind advanced toggle. Config-driven — dependency types and cascade rules defined in a definition file (like design-tokens.ts), not hardcoded. Cascade engine reads from config. Workspace-scoped only (no cross-workspace deps). Cross-project risk handled via portfolio visibility, not hard dependencies. Lag/lead time supported on all types. |

### L1-3. Rolling undo

| | |
|---|---|
| **Vision says** | Every action undoable, not just the last one. Roll back one at a time. Applies to manual edits, AI changes, and dependency cascades. Toast notification on every action with immediate undo. Full undo history accessible. |
| **Codebase has** | `activities` table logs all changes (16 activity types) with before/after values in JSON `data` field. Toast notifications exist (Sonner). But **no undo mechanism** — activities are read-only audit log. |
| **Verdict** | **EXTEND** (significant) |
| **Notes** | The activities table already captures the "what changed" data needed for undo. Need: reverse-action logic per activity type, undo stack management (per-user, per-session), toast with undo button on every mutation, bulk undo for cascade operations. The `data` field storing `{field, oldValue, newValue}` is the right shape — needs a `revertActivity(activityId)` action. |

### L1-4. Timeline / Gantt view

| | |
|---|---|
| **Vision says** | Primary project view. Modern, clean, agency-quality. Resources annotated on timeline. Milestone markers with date callouts. Shaded blocks for holds, reviews, freezes. |
| **Codebase has** | `VIEW.TIMELINE` exists in design tokens. **No implementation.** Board (kanban) and List views only. |
| **Verdict** | **BUILD** |
| **Notes** | Major component. Needs: horizontal time axis, task bars with drag-to-resize, phase containers, milestone markers, dependency arrows (Layer 1 deps), resource annotations, zoom levels (day/week/month/quarter). Libraries to consider: custom SVG/Canvas renderer or adapt a library. This is where Layer 1 meets Layer 2 — the timeline is both a PM tool and the base rendering for canvas views. |

### L1-5. Copy everything, adapt anything

| | |
|---|---|
| **Vision says** | Templates for common project types. Copy project → adapt for new client. Copy phase, task group, view. Every copy brings structure, user adapts content. |
| **Codebase has** | `createStarterIssues` creates issues from a template for marketing projects. Workspace creation has template-based columns/labels. No project copy, no phase copy, no view copy, no template library. |
| **Verdict** | **EXTEND** |
| **Notes** | Need: deep-copy operations (workspace → new workspace with all issues/columns/labels/epics/cycles), phase copy, template save/load system. Mapping UI for "source phase → destination phase" when copying across clients. The existing starter issue pattern is the right idea, just needs to scale to full project structures. |

### L1-6. Per-client brand palette

| | |
|---|---|
| **Vision says** | Color picker with hex input and color wheel. Font selection. Brand palette saved per client, applies automatically to all views. Easy to override per element. Art-tool-grade customization. |
| **Codebase has** | `brands` table exists with `primaryColor`, `secondaryColor`, and `guidelines` (JSON). Workspaces reference a brand. Brand research + guidelines extraction via AI exists. **But**: no color picker UI, no font selection, no per-element override system, no palette application to views. Brand is identity metadata, not a rendering system. |
| **Verdict** | **EXTEND** (significant) |
| **Notes** | Brand data model is partially there. Need: extended palette schema (primary, secondary, accent, background, text colors — not just 2), font family selection and storage, color picker UI component (hex, wheel, eyedropper), palette application engine that themes all canvas elements automatically, per-element override flag. The vision says "closer to Figma" for the design bar. |

### L1-7. Start/end dates on issues

| | |
|---|---|
| **Vision says** | Tasks have date ranges (start + end), shown as bars on timeline. Ongoing tasks (no end date). Phases span date ranges. |
| **Codebase has** | Issues have `dueDate` only. **No `startDate`.** No date range concept. |
| **Verdict** | **EXTEND** |
| **Notes** | Add `startDate` to issues table. This is required for any timeline/Gantt rendering. Also needed: "ongoing" flag or null endDate convention. Phases need their own date ranges. |

---

## Layer 2: Canvas / Storytelling

### L2-1. Canvas rendering engine

| | |
|---|---|
| **Vision says** | Named views at different altitudes above base data. Each view is a distinct canvas with its own time window, zoom level, and element composition. Not zoom levels of the same canvas. |
| **Codebase has** | **Nothing.** No canvas, no spatial layout, no element positioning, no view system beyond board/list. |
| **Verdict** | **BUILD** (largest single build) |
| **Notes** | This is the USP. Need: canvas rendering engine (HTML5 Canvas or SVG), pan/zoom, element placement system (x/y coordinates + width/height), snap-to-grid, time axis rendering, view container model (each view = saved state of canvas configuration). Consider: react-konva, fabric.js, or custom SVG. The canvas must render connected elements from project data AND free-floating elements on the same surface. |

### L2-2. 16+ canvas element types

| | |
|---|---|
| **Vision says** | Phase containers, task bars, milestone markers, narrative connectors, callouts, outcome cards, urgency boxes, legends, date markers, grids, deliverable matrices, continuation indicators, floating labels, hyperlinks, blackout overlays, gate/checkpoint blocks. |
| **Codebase has** | IssueCard (kanban card), IssueRow (list row). No spatial/canvas elements. |
| **Verdict** | **BUILD** |
| **Notes** | Each element type needs: render component, property schema (position, size, colors, text, connected data), selection/resize handles, property editor panel. Start with the most-used types (phase container, task bar, milestone, connector, callout) and build out. Connected elements need a binding to Layer 1 data (issueId, phaseId, milestoneId). Free-floating elements need their own persistence. |

### L2-3. Narrative connectors

| | |
|---|---|
| **Vision says** | Lines between elements for storytelling. Curved Bezier, multiple line styles (solid, dashed, dotted). 1:1, 1:N, N:1, circular. NOT dependencies — freely drawn. Move when connected elements move. |
| **Codebase has** | Nothing. |
| **Verdict** | **BUILD** |
| **Notes** | Connector system: source anchor + target anchor on elements, path routing (avoid overlaps), style properties (color, width, dash pattern, arrowhead), label on connector. Must auto-update path when either endpoint element moves. This is distinct from L1 dependencies — connectors are visual only, stored in the canvas view, not in the project data. |

### L2-4. Connected vs. free-floating element spectrum

| | |
|---|---|
| **Vision says** | Two types: connected (tied to real tasks/phases/milestones in Layer 1) and free-floating (exist purely for storytelling). Both first-class. |
| **Codebase has** | No element system. |
| **Verdict** | **BUILD** |
| **Notes** | Data model: canvas elements need an optional `sourceType` + `sourceId` binding (null = free-floating, "issue"/"phase"/"milestone" + id = connected). Connected elements auto-update position/dates/labels when source data changes. Free-floating elements are fully user-controlled. |

### L2-5. Ripple effect / graceful re-composition

| | |
|---|---|
| **Vision says** | When base data changes, connected elements adjust, downstream elements adjust, visual presentation re-composes gracefully to stay beautiful. Layout engine problem. |
| **Codebase has** | Nothing. |
| **Verdict** | **BUILD** |
| **Notes** | This is the hardest technical challenge in the canvas. Needs: layout constraint system (elements maintain relative spacing, connectors re-route, free-floating elements avoid collision), animation for transitions, "settle" algorithm that preserves aesthetic after data-driven changes. Research: constraint-based layout engines, force-directed graphs, or custom auto-layout rules. |

### L2-6. Altitude-based views with spatial relationship indicator

| | |
|---|---|
| **Vision says** | Views at different altitudes (10,000 ft, 20,000 ft, etc.). Not zoom levels — distinct named views. UI element shows "you are three levels above the base project." Renameable. |
| **Codebase has** | Nothing. |
| **Verdict** | **BUILD** |
| **Notes** | Data model: `canvasViews` table (workspaceId, name, altitude/order, timeWindow, zoomLevel, elementConfiguration). UI: vertical navigator showing view stack with current position highlighted. Each view has its own set of visible/hidden elements and its own time window. |

### L2-7. View time windows

| | |
|---|---|
| **Vision says** | Each view has its own time window: week, month, quarter, year, or custom date range. |
| **Codebase has** | Dashboard has a `timeRange` concept (day/week/month). Not applied to views. |
| **Verdict** | **BUILD** |
| **Notes** | Per-view property. The time axis renderer needs to adapt to the window. Elements outside the window are hidden or shown with continuation indicators. |

### L2-8. Visibility control (per element, per view)

| | |
|---|---|
| **Vision says** | Boolean per element per view. Any element independently shown/hidden. Collapsing a group shows parent bar only. Detail still connected to data, just not visible. |
| **Codebase has** | Nothing. |
| **Verdict** | **BUILD** |
| **Notes** | Junction table: `canvasViewElements` (viewId, elementId, visible, collapsed, positionOverride). Each view stores its own visibility state for every element. |

### L2-9. Ad hoc view assembly

| | |
|---|---|
| **Vision says** | Build a view by selecting exactly what you want to show. Checkmark specific rows, milestones, dates. Selection becomes a named, saveable view. |
| **Codebase has** | Filter system exists for issues (by status, priority, label, etc.) but only for board/list views. |
| **Verdict** | **BUILD** |
| **Notes** | UI: element picker that shows all project data, checkmarks to include in current view. Save as named view. This is the bridge between "I have 200 tasks" and "I want to show these 12 things to a client." |

### L2-10. AI-assisted view creation

| | |
|---|---|
| **Vision says** | Describe a view, get a starting point. Ask questions about what's on screen, get answers from data. Canvas is a thinking surface. |
| **Codebase has** | AI chat infrastructure exists (workspace, issue, planning contexts). AI planning can decompose features into issues. Could be extended to view generation. |
| **Verdict** | **EXTEND** |
| **Notes** | New AI tools: `createCanvasView` (from natural language description), `queryCanvasData` (answer questions about visible elements). Reuse existing chat infrastructure, add canvas-aware tools. The Vercel AI SDK + tool system is well-suited for this. |

### L2-11. Copy views across projects

| | |
|---|---|
| **Vision says** | View copies from one project to another. Structure + layout carry over. Matching interface maps source phases to destination phases. Content updates to new project. |
| **Codebase has** | No view system to copy. |
| **Verdict** | **BUILD** |
| **Notes** | Depends on L2-1 existing first. Copy operation: duplicate view element configuration, run mapping UI (source element → destination element), re-bind connected elements to new project data, preserve free-floating elements as-is. |

### L2-12. Snapshot export (PNG / slide-ready image)

| | |
|---|---|
| **Vision says** | Any view exports as PNG or slide-ready image. One click. |
| **Codebase has** | `print-to-pdf.ts` exists for markdown → PDF via browser print. No canvas export. |
| **Verdict** | **BUILD** |
| **Notes** | If canvas is SVG-based, export is straightforward (SVG → PNG via canvas API). If HTML5 Canvas-based, use `toDataURL()`. Need: export button, resolution options, background inclusion, crop to view bounds. |

### L2-13. Canvas layout modes

| | |
|---|---|
| **Vision says** | 6 layout modes: full-width timeline, timeline + right sidebar, left sidebar + timeline, split-pane, multi-column text, vertical cascade. |
| **Codebase has** | Nothing. |
| **Verdict** | **BUILD** |
| **Notes** | Layout engine needs configurable panel arrangement. Each view stores its layout mode. Some modes (split-pane, sidebar) require responsive panel sizing. |

### L2-14. Zoom level hierarchy (4+ levels)

| | |
|---|---|
| **Vision says** | Roadmap (quarterly), Full Project (weekly), Phase-Focused (weekly cropped), Launch Countdown (daily). Same data renders differently at each level. Sub-tasks auto-collapse at lower zoom. |
| **Codebase has** | Nothing. |
| **Verdict** | **BUILD** |
| **Notes** | Zoom is a view property that controls: time axis granularity, element detail level (collapse/expand thresholds), label truncation, connector simplification. Need LOD (level of detail) system for elements. |

### L2-15. Template / stamp system for repeating patterns

| | |
|---|---|
| **Vision says** | Review-round workflows, batch production, campaign cycles, sprint pairs — all need template/stamp mechanism. |
| **Codebase has** | Basic issue templates (`createStarterIssues`). No canvas element templates. |
| **Verdict** | **BUILD** |
| **Notes** | Templates need to work at two levels: (1) project data templates (create a batch of tasks from a pattern), (2) canvas element templates (stamp a visual pattern onto the canvas). Save any group of elements + their arrangement as a reusable template. |

### L2-16. Design bar (closer to Figma than PowerPoint)

| | |
|---|---|
| **Vision says** | Fonts, colors, bar styles, connector styles, backgrounds, annotations, callout boxes, icons, spacing, visual hierarchy. Not pixel-level but component-based with rich customization. |
| **Codebase has** | Nothing. Property editors exist for issue fields (status, priority, etc.) but not for visual styling. |
| **Verdict** | **BUILD** |
| **Notes** | Design toolbar: font picker, color picker (with brand palette presets), border/shadow controls, opacity, text alignment, element-specific style options. This is the art-tool side of the canvas. Every element type needs a style schema and corresponding property panel. |

---

## Layer 3: Resourcing

### L3-1. Resource (people) model

| | |
|---|---|
| **Vision says** | Resources are people. Allocated at percentage to clients, projects, phases, tasks — mixed model. |
| **Codebase has** | `users` table exists. `workspaceMembers` exists (user ↔ workspace). `assigneeId` on issues (single assignee per issue). **No allocation model, no percentage, no capacity tracking.** |
| **Verdict** | **BUILD** |
| **Notes** | Need: `allocations` table (userId, targetType [client/project/phase/task], targetId, percentage, startDate, endDate, milestoneId?). Each user needs a `capacity` field (default 100%). Allocations sum per user across all targets. The mixed model (different target levels coexisting) is the key differentiator vs. Float/Resource Guru/Productive. |
| **DECIDED** | One capacity bar per person, always shown as %. Two input paths: manual entry for agency-style (PM types "50%"), derived from velocity for agile-style (sprint commitment / velocity = %). Translation layer isolated in its own code block for refinement. Allocation source tracked: "manual" or "derived." PM can override derived allocations with confirmation UX. Mixed levels supported (client=open-ended, project=either, phase/task=time-bound, flexibility always). Scenario planning (tentative allocations) deferred — data model ready for it (`isTentative` flag) but UI comes after real allocations work. |

### L3-2. Capacity view (cross-project)

| | |
|---|---|
| **Vision says** | Every active resource, total allocation across all work, date ranges driving the number. Visible when someone's at 110%. Drill down from resource to what drives the load. |
| **Codebase has** | Nothing. Dashboard has workspace-level summaries but no resource/capacity view. |
| **Verdict** | **BUILD** |
| **Notes** | New view: resource timeline showing each person as a row, stacked allocation bars, overallocation highlighting (>100% in red). Drill-down: click person → see all allocations with source links. Needs to aggregate across all workspaces the user has access to. |

### L3-3. Portfolio / agency-level view

| | |
|---|---|
| **Vision says** | Everything in flight across all clients. Day/week/month filter. Deliverables due, resources on them, ladder to parent project/client. Planning tool for new business decisions. |
| **Codebase has** | `getDashboardData` fetches across workspaces (myIssues, newIssues, recentActivities). Basic multi-workspace querying exists. No portfolio visualization. |
| **Verdict** | **BUILD** |
| **Notes** | Extends dashboard data with: client grouping, resource overlay, deliverable calendar, new-business impact simulation. The multi-workspace query pattern exists — needs a portfolio-specific UI and aggregation layer. |

### L3-4. New business scenario planning

| | |
|---|---|
| **Vision says** | Before saying yes to new business, see what it does to the workforce. Who's available, who's at capacity, what's coming off in 60 days, what new engagement requires. |
| **Codebase has** | Nothing. |
| **Verdict** | **BUILD** |
| **Notes** | Need: tentative allocations (allocations with a "tentative" flag), scenario comparison view (current state vs. with-new-project), capacity projection over time. No existing tool does this well — competitive advantage. |

---

## AI Features

### AI-1. Natural language timeline management

| | |
|---|---|
| **Vision says** | "Add three days to Design R1 on Convergix and push everything downstream." Confirms before executing. Rolling undo after. |
| **Codebase has** | AI chat with tool calling exists. Issue update tools exist. No dependency cascade tools. No timeline manipulation tools. |
| **Verdict** | **EXTEND** |
| **Notes** | New AI tools: `shiftTask`, `cascadeDependencies`, `previewCascadeImpact`. Requires L1-2 (dependencies) to exist first. Confirmation flow: AI shows proposed changes, user approves, system executes + logs for undo. |

### AI-2. Portfolio Q&A

| | |
|---|---|
| **Vision says** | Ask anything across all active work. "What's due this week?" "Who's overallocated in April?" |
| **Codebase has** | Dashboard summary generation exists (AI-generated markdown digest). Workspace-scoped chat exists. No cross-workspace querying via AI. |
| **Verdict** | **EXTEND** |
| **Notes** | Extend chat tools with cross-workspace query capabilities. Needs L3-1 (allocations) for resource questions. The getDashboardData action already aggregates across workspaces — wire it into AI tools. |

### AI-3. Alerts and nudges

| | |
|---|---|
| **Vision says** | Overallocated resource, missed milestone, timeline drift — surfaced as flags, not blockers. PM decides what to do. |
| **Codebase has** | Nothing proactive. Activities are logged but not analyzed. |
| **Verdict** | **BUILD** |
| **Notes** | Need: alert engine (scheduled check or triggered on data change), alert types (overallocation, past-due, drift detection), notification UI (badge + panel), dismiss/snooze capability. Could run as Inngest cron job. |

---

## Cross-Cutting Concerns

### CC-1. Client entity

| | |
|---|---|
| **Vision says** | Clients as first-class entities that own multiple projects/workspaces. |
| **Codebase has** | `brands` table has client identity info (name, logo, colors, guidelines). Workspaces have a `brandId` foreign key. But brands are user-owned, not organization-level. No explicit "client" grouping that spans workspaces. |
| **Verdict** | **EXTEND** |
| **Notes** | Brand already stores the right visual identity data. The key addition is: a client groups multiple workspaces, and the portfolio view filters by client. |
| **DECIDED** | Workspace = Project (stays as-is). New `clients` table above workspaces. Brands link to clients (client visual identity). Workspaces get a `clientId` foreign key. All existing workspace-scoped code remains valid — additive change. Research Jira/Trello/Asana patterns before finalizing schema. |

### CC-2. Phases as first-class entity

| | |
|---|---|
| **Vision says** | Projects have phases (concurrent or sequential). Phases are timeline containers for tasks. |
| **Codebase has** | `epics` exist (planning groups with status/dueDate). No date range (start + end). No explicit phase rendering on timeline. |
| **Verdict** | **BUILD** |
| **Notes** | Epics are close but not quite phases. Phases need: startDate + endDate (epics only have dueDate), visual representation as container bars on timeline, allocation target for resourcing. |
| **DECIDED** | Phases are a new entity, separate from epics. Epics = scope (what), Phases = stage (when in the project lifecycle). Cycles (sprints) also stay separate = agile rhythm. All three coexist. No phase-level dependencies — use milestones as gates between phases instead (approval checkpoints). |

### CC-3. Multi-workspace operations

| | |
|---|---|
| **Vision says** | Portfolio view, cross-project dependencies, cross-project resource allocation. |
| **Codebase has** | All operations are workspace-scoped. `requireWorkspaceAccess` enforces per-workspace auth. Dashboard fetches across workspaces but only for the current user's workspaces. |
| **Verdict** | **EXTEND** |
| **Notes** | Need: organization/agency-level grouping above workspaces, cross-workspace query patterns, permission model for portfolio-level access. The existing `workspaceMembers` pattern could be extended to an `organizationMembers` level. |

---

## Summary: Build Priority by Dependency

### Must build first (everything else depends on these)

| ID | Item | Verdict | Why first |
|---|---|---|---|
| L1-7 | Start dates on issues | EXTEND | Timeline rendering requires date ranges |
| L1-1 | Client → Project → Phase hierarchy | BUILD+EXTEND | Layer 2 views and Layer 3 resources need this structure |
| CC-1 | Client entity | EXTEND | Portfolio view, brand palette, and multi-project features need this |
| CC-2 | Phases as first-class | EXTEND/BUILD | Timeline, canvas, and resourcing all reference phases |

### Layer 1 core (build next)

| ID | Item | Verdict |
|---|---|---|
| L1-2 | Dependencies + cascade | BUILD |
| L1-3 | Rolling undo | EXTEND |
| L1-4 | Timeline / Gantt view | BUILD |
| L1-5 | Copy everything | EXTEND |
| L1-6 | Brand palette system | EXTEND |

### Phase 0 (can build in parallel with L1 foundations)

| ID | Item | Verdict |
|---|---|---|
| P0-1 | TV display | BUILD |
| P0-2 | Web view | EXTEND |
| P0-3 | Trackpad UX | BUILD (minor) |

### Layer 2 canvas (after L1 timeline exists)

| ID | Item | Verdict |
|---|---|---|
| L2-1 | Canvas engine | BUILD |
| L2-2 | 16+ element types | BUILD |
| L2-3 | Narrative connectors | BUILD |
| L2-4 | Connected vs. free-floating | BUILD |
| L2-5 | Ripple effect / layout engine | BUILD |
| L2-6 | Altitude views | BUILD |
| L2-7–L2-16 | All other canvas features | BUILD |

### Layer 3 resourcing (after client/phase hierarchy exists)

| ID | Item | Verdict |
|---|---|---|
| L3-1 | Resource allocation model | BUILD |
| L3-2 | Capacity view | BUILD |
| L3-3 | Portfolio view | BUILD |
| L3-4 | Scenario planning | BUILD |

### AI extensions (after their data dependencies exist)

| ID | Item | Depends on |
|---|---|---|
| AI-1 | NL timeline management | L1-2 (dependencies) |
| AI-2 | Portfolio Q&A | L3-1 (allocations) |
| AI-3 | Alerts/nudges | L1-2, L3-1 |
| L2-10 | AI view creation | L2-1 (canvas engine) |

---

## Conflicts (with Resolutions)

### Conflict 1: Workspace ≠ Project — RESOLVED

The codebase treats workspaces as the top-level container (renamed from "boards"). The vision treats projects as containers within clients.

**Resolution:** Workspace = Project. Brands already loosely serve as client identity. Add a `clients` table above workspaces, link brands to clients. Workspaces get a `clientId`. All existing workspace-scoped code remains valid — this is additive, not disruptive. Portfolio view queries across workspaces filtered by client. Research needed: how Jira, Trello, and Asana handle the project/workspace/board relationship before finalizing.

### Conflict 2: Epics vs. Phases vs. Cycles — RESOLVED

Three overlapping time/grouping concepts that serve different purposes.

**Resolution:** Keep all three as separate entities.
- **Epics** = what you're building (scope bucket, agile planning unit). No date range needed.
- **Cycles** = what sprint you're doing it in (agile time slice, repeating fixed windows). Has start/end dates. Agency projects would ignore this.
- **Phases** = what stage the project is in (agency time slice, custom stretches like "Design: 6 weeks"). Has start/end dates. Renders as container bars on Gantt/canvas. New entity to build.

An issue can belong to all three simultaneously: "This task is part of the Redesign epic, being worked in Sprint 12, during the Development phase." Each answers a different question.

### Conflict 3: Single assignee — RESOLVED (deferred)

Issues have `assigneeId` (single person). Resourcing needs multiple people at different percentages.

**Resolution:** The `allocations` table handles multi-person resourcing separately from issue assignment. `assigneeId` stays as the "primary owner" — the person responsible for the task. Allocations capture who else is spending time on it and at what percentage. UI transition from single-avatar to multi-resource display happens gradually as the resourcing layer is built.

### Conflict 4: Agile vs. Agency Paradigm — RESOLVED

The tool must support both agile product development and agency deliverable-driven PM without forcing either.

**Resolution:** One data model underneath, two vocabulary layers on top. Project paradigm chosen at creation time adapts terminology, default behaviors, and visible controls. Canvas layer and resourcing read the same data regardless of style. ~80% of projects expected to run agency-style, ~20% agile/technical. See `/docs/agile-vs-agency-pm.md` for full analysis.

Key implication: features should be config-driven and vocabulary-aware rather than hardcoding assumptions about how projects run. PM methodology is in flux due to AI changing execution speed — the architecture must preserve optionality.

---

## What We Keep As-Is

These existing features need no changes for the Round One vision:

- **Auth system** (WorkOS) — works for all roles
- **Issue CRUD** — core operations are solid
- **Optimistic updates** — pattern applies everywhere
- **Activity logging** — foundation for undo
- **AI chat infrastructure** — extensible for new tools
- **AI skills system** — reusable for canvas/planning skills
- **Knowledge base** — useful for project documentation
- **Inngest background jobs** — reusable for alerts, AI tasks
- **Token usage tracking** — applies to all AI features
- **R2 file storage** — reusable for exports, attachments
- **React Query** — data fetching pattern scales
- **Design tokens** — extend with new statuses/views
- **DnD system** — board view stays as-is
- **Comment/discussion** — works for all entities
