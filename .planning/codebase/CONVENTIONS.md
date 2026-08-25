# Coding Conventions

**Analysis Date:** 2026-08-04

## Naming Patterns

**Files:**
- React components: PascalCase `.tsx` (e.g., `BoardView.tsx`, `RunwayBoard.tsx`)
- Utility/lib modules: kebab-case `.ts` (e.g., `brand-utils.ts`, `memory-utils.ts`)
- Server actions: kebab-case `.ts` files grouped under `src/lib/actions/`
- Tests: co-located, same name with `.test.ts` / `.test.tsx` suffix
- Context providers: PascalCase with `Provider` or `Context` suffix (e.g., `BoardProvider.tsx`, `IssueFormContext.tsx`)

**Functions:**
- Exported utilities: camelCase (e.g., `filterIssues`, `generateIdempotencyKey`)
- React components: PascalCase (e.g., `RunwayBoard`, `InFlightSection`)
- Custom hooks: `use` prefix + PascalCase (e.g., `useURLState`, `useFeature`)
- Server actions: camelCase ending in `Action` for client-facing mutations

**Variables:**
- camelCase throughout
- Constants: SCREAMING_SNAKE_CASE for enum-style values (e.g., `STATUS.TODO`, `STATUS.DONE` in `src/lib/design-tokens.ts`)

**Types:**
- PascalCase interfaces and types (e.g., `IssueWithLabels`, `FilterState`, `Brand`)
- `type` keyword preferred over `interface` for data shapes; `interface` for extension points

## Code Style

**Formatting:**
- No explicit Prettier config detected; formatting enforced via ESLint + Next.js recommended rules
- Consistent double-quote strings in TypeScript, single-quote where needed

**Linting:**
- ESLint with `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`
- Config: `eslint.config.mjs`
- Run: `pnpm lint`
- Ignored: `.next/`, `out/`, `build/`, `.vercel/`, `public/nutrient-viewer/`, `docs/tmp/`, `scripts/worktree-scratch/`

**TypeScript:**
- `strict: true` in `tsconfig.json`
- `noEmit: true` (type-check only; build handled by Next.js)
- Vitest globals enabled via `"types": ["vitest/globals"]`

## Import Organization

**Path Aliases:**
- `@/*` maps to `src/*` (configured in both `tsconfig.json` and `vitest.config.mts`)

**Order (observed pattern):**
1. External packages (`vitest`, `react`, `next/*`, third-party)
2. Internal aliases (`@/lib/...`, `@/components/...`)
3. Relative imports (`./foo`, `../bar`)

**Mock imports:** Always declare `vi.mock(...)` calls before the `import` of the module under test to ensure hoisting works correctly (see `src/lib/auth.test.ts`).

## Error Handling

**Patterns:**
- Server actions use early `throw` for auth failures (via `requireWorkspaceAccess`)
- Next.js sentinel errors (`DYNAMIC_SERVER_USAGE`, `NEXT_REDIRECT`) are re-thrown rather than swallowed; see `src/lib/auth.ts` and its test
- Async functions return typed results; no untyped promise chains

## Comments

**When to Comment:**
- Module-level JSDoc blocks for complex utilities
- Inline comments explain non-obvious invariants (e.g., why a mock returns a specific shape)
- Test files use `// ── Section ──` horizontal rule comments to visually separate mock setup from test suites

**TSDoc:**
- Sparse; used primarily on complex exported functions, not required everywhere

## Function Design

**Size:** Functions extracted when logic is reusable or testable in isolation; large files exist (see `operations-utils.ts` at 1,576 lines) indicating this rule is inconsistently applied

**Parameters:** Options objects preferred for functions with 3+ parameters

**Return Values:** Typed returns; async functions always `Promise<T>`, never implicit `any`

## Module Design

**Exports:** Named exports preferred throughout; no default exports on utility modules
**Barrel Files:** Not observed as a systematic pattern; imports go directly to source files
**Server Actions:** Grouped per-domain under `src/lib/actions/` (e.g., `brand.ts`, `audience.ts`, `columns.ts`)

## Skill-Defined Quality Gates

The repo ships these built-in quality enforcement skills under `.claude/skills/`:

| Skill | Purpose |
|-------|---------|
| `preflight` | Build + runtime-error grep + tests + lint + security audit + optional Vercel build |
| `code-review` | DRY, prop drilling, hooks/context, test coverage check |
| `pr-ready` | Debug statements, DRY, React structure, prop drilling before PR |
| `canary` | Canary deploy / smoke check |
| `runway-visual-qa` | Screenshot-based visual regression |

`preflight` is the canonical pre-commit gate. It hard-fails on: build failure, banned runtime-error patterns in build output, test failure, lint failure, Vercel build failure (runway branches).

---

*Convention analysis: 2026-08-04*
