import { Board } from "@/components/board/Board";
import { getOrCreateDefaultBoard } from "@/lib/actions/board";

export default async function Home() {
  const board = await getOrCreateDefaultBoard();

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Auto Kanban</h1>
        <p className="text-zinc-400 mt-2">
          AI-powered kanban board with automatic user story generation
        </p>
      </header>
      <main>
        <Board initialBoard={board} />
      </main>
    </div>
  );
}
