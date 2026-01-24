# Auto Kanban

A Trello-style kanban board built with Next.js, featuring drag-and-drop card management and database persistence.

## Tech Stack

- **Framework**: Next.js 16 with React 19
- **Database**: SQLite via Drizzle ORM + libSQL
- **Drag & Drop**: @dnd-kit/core + @dnd-kit/sortable
- **UI Components**: shadcn/ui + Radix UI primitives
- **Styling**: Tailwind CSS v4
- **Testing**: Vitest + React Testing Library

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm

### Installation

```bash
pnpm install
```

### Database Setup

Generate and run migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Scripts

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `pnpm dev`          | Start development server     |
| `pnpm build`        | Build for production         |
| `pnpm start`        | Start production server      |
| `pnpm lint`         | Run ESLint                   |
| `pnpm test`         | Run tests in watch mode      |
| `pnpm test:run`     | Run tests once               |
| `pnpm db:generate`  | Generate database migrations |
| `pnpm db:migrate`   | Run database migrations      |
| `pnpm db:studio`    | Open Drizzle Studio          |
| `pnpm format`       | Format code with Prettier    |
| `pnpm format:check` | Check code formatting        |

## Project Structure

```
src/
├── app/                    # Next.js app router
│   ├── page.tsx            # Main board page
│   └── globals.css         # Global styles
├── components/
│   ├── board/              # Kanban board components
│   │   ├── Board.tsx       # Main board with DnD context
│   │   ├── Column.tsx      # Column with droppable zone
│   │   ├── Card.tsx        # Draggable card
│   │   ├── CardModal.tsx   # Card edit dialog
│   │   └── AddCardForm.tsx # Inline card creation
│   └── ui/                 # shadcn/ui components
├── lib/
│   ├── actions/            # Server actions
│   │   ├── board.ts        # Board fetching/creation
│   │   └── cards.ts        # Card CRUD operations
│   ├── db/                 # Database configuration
│   │   ├── index.ts        # Drizzle client
│   │   └── schema.ts       # Database schema
│   ├── types.ts            # TypeScript types
│   └── utils.ts            # Utility functions
```

## Features

- Create, edit, and delete cards
- Drag and drop cards between columns
- Reorder cards within columns
- Optimistic UI updates
- Dark mode support
- Persistent storage with SQLite

## License

MIT
