# Technology Stack

**Analysis Date:** 2026-08-04

## Languages

**Primary:**
- TypeScript 5.x - All application code (`src/**/*.ts`, `src/**/*.tsx`)
- TSX - React component files throughout `src/components/`, `src/app/`

**Secondary:**
- JavaScript (`.mjs`) - Build scripts in `scripts/` (excluded from TS compilation)
- CSS - Global styles at `src/app/globals.css`

## Runtime

**Environment:**
- Node.js 20.x (implied by `@types/node: ^20`)

**Package Manager:**
- pnpm (lockfile: `pnpm-lock.yaml` present, committed)
- npm lockfile also present (`package-lock.json`) - dual lockfile is a minor inconsistency

## Frameworks

**Core:**
- Next.js 16.2.4 - Full-stack React framework; App Router in `src/app/`; API routes under `src/app/api/`
- React 19.2.3 - UI layer
- React DOM 19.2.3 - DOM renderer

**UI / Component:**
- Tailwind CSS 4.x - Utility-first CSS; config via `postcss.config.mjs`
- Radix UI (multiple packages `^1-^2`) - Headless accessible primitives (Dialog, DropdownMenu, Select, Tabs, Tooltip, Popover, etc.)
- Lucide React 0.562.0 - Icon library (import-optimized via `next.config.ts`)
- shadcn/ui convention - `components.json` present; component registry pattern
- class-variance-authority + clsx + tailwind-merge - Variant/conditional class utilities
- @dnd-kit (core, sortable, utilities) - Drag-and-drop
- Lexical 0.35.0 + plugins - Rich text editor
- Recharts 3.7.0 - Chart/data visualization
- cmdk 1.1.1 - Command palette
- sonner 2.0.7 - Toast notifications

**State / Data Fetching:**
- TanStack Query (React Query) 5.90.20 - Server-state management
- TanStack Table 8.21.3 - Data table
- TanStack Virtual 3.13.18 - Virtualized lists

**AI / LLM:**
- Vercel AI SDK (`ai` 6.0.48, `@ai-sdk/anthropic` 3.0.23, `@ai-sdk/react` 3.0.50, `@ai-sdk/mcp` 1.0.13) - AI streaming and tool-use
- Model Context Protocol SDK 1.29.0 - MCP server/client integration
- Smithery API 0.29.0 - MCP registry client

**Background Jobs:**
- Inngest 3.54.0 - Durable event-driven background functions; functions in `src/lib/inngest/functions/`

**Email:**
- Resend 6.9.2 - Transactional email delivery
- @react-email/components 1.0.8 - Email templates

**Testing:**
- Vitest 4.0.17 - Unit/integration test runner; config at `vitest.config.mts`
- @testing-library/react 16.3.2 + @testing-library/jest-dom 6.9.1 + @testing-library/user-event 14.6.1 - DOM testing utilities
- happy-dom 20.3.4 - DOM environment for Vitest (primary)
- jsdom 27.4.0 - Alternative DOM environment (available)
- Playwright 1.60.0 - E2E smoke tests against `runway.startround1.com`; config at `playwright.config.ts`; tests in `tests/runway/`

**Build/Dev:**
- drizzle-kit 0.31.8 - DB migrations and schema management CLI
- concurrently 9.2.1 - Parallel dev server processes
- tsx - TypeScript script runner for `scripts/*.ts`
- Prettier 3.8.1 - Code formatting
- ESLint 9.x + eslint-config-next - Linting; config at `eslint.config.mjs`

## Key Dependencies

**Critical:**
- `drizzle-orm` 0.45.2 - ORM for both SQLite (local) and Turso (prod); schemas at `src/lib/db/schema.ts` and `src/lib/db/runway-schema.ts`
- `@libsql/client` 0.17.0 - LibSQL client used by Turso dialect
- `@workos-inc/authkit-nextjs` 2.13.0 - Authentication/session management; implemented in `src/lib/auth.ts`
- `iron-session` 8.0.4 - Encrypted cookie sessions
- `zod` 4.3.5 - Schema validation; used in `src/lib/schemas/`
- `@slack/web-api` 7.15.0 - Slack bot integration

**Infrastructure:**
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.975.0 - File storage via S3
- `nanoid` 5.1.6 - ID generation
- `date-fns` 4.1.0 + `dayjs` 1.11.19 - Date utilities (both present; potential duplication)
- `gray-matter` 4.0.3 - Markdown/frontmatter parsing
- `jszip` 3.10.1 - ZIP file handling

## Configuration

**Environment:**
- `.env.local` for local development (not committed)
- Key env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `RUNWAY_DATABASE_URL`, `RUNWAY_AUTH_TOKEN`
- Feature-flag and service toggle files at `src/lib/feature-flags.ts`

**Build:**
- `next.config.ts` - Minimal Next.js config; `optimizePackageImports` for lucide-react
- `tsconfig.json` - Strict TypeScript; path alias `@/*` maps to `src/*`; excludes `scripts/` and `cloudflare/`
- `postcss.config.mjs` - PostCSS for Tailwind 4
- Two separate Drizzle configs: `drizzle.config.ts` (main DB) and `drizzle-runway.config.ts` (Runway DB)

## Platform Requirements

**Development:**
- Node 20+, pnpm
- Local SQLite via `file:local.db` and `file:runway-local.db` when Turso env vars absent
- Optional: Inngest CLI for background job development (`pnpm dev:inngest`)

**Production:**
- Vercel (implied by `eslint.config.mjs` referencing `.vercel/**` artifacts and `cloudflare/` directory suggesting Cloudflare Workers for browser automation)
- Turso (LibSQL cloud) for both main and Runway databases
- AWS S3 for file storage
- Deployment target: `runway.startround1.com` (confirmed in `playwright.config.ts`)

---

*Stack analysis: 2026-08-04*
