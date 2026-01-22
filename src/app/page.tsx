export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Auto Kanban</h1>
        <p className="text-zinc-400 mt-2">
          AI-powered kanban board with automatic user story generation
        </p>
      </header>
      <main className="flex gap-4">
        <div className="flex-1 bg-zinc-900 rounded-lg p-4 min-h-[500px]">
          <h2 className="font-semibold mb-4 text-zinc-300">To Do</h2>
        </div>
        <div className="flex-1 bg-zinc-900 rounded-lg p-4 min-h-[500px]">
          <h2 className="font-semibold mb-4 text-zinc-300">In Progress</h2>
        </div>
        <div className="flex-1 bg-zinc-900 rounded-lg p-4 min-h-[500px]">
          <h2 className="font-semibold mb-4 text-zinc-300">Done</h2>
        </div>
      </main>
    </div>
  );
}
