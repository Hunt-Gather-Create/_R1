import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUserWorkspaces } from "@/lib/actions/workspace";
import { Plus, Folder, LayoutDashboard } from "lucide-react";
import type { Workspace } from "@/lib/types";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  return (
    <Link
      href={`/w/${workspace.slug}`}
      className="project-card-wrapper group block"
    >
      <div className="project-card-content p-5 flex flex-col">
        {/* Icon */}
        <div className="w-12 h-12 rounded-lg bg-sky-500/20 flex items-center justify-center mb-4">
          <Folder className="w-6 h-6 text-sky-400" />
        </div>

        {/* Content */}
        <div className="flex-1">
          <h3 className="font-semibold text-foreground group-hover:text-sky-400 transition-colors line-clamp-1">
            {workspace.name}
          </h3>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {workspace.purpose === "software" && "Software development project"}
            {workspace.purpose === "marketing" && "Marketing campaign project"}
            {workspace.purpose === "sales" && "Sales pipeline project"}
            {workspace.purpose === "custom" && "Custom workspace"}
          </p>
        </div>

        {/* Date */}
        <p className="text-xs text-muted-foreground mt-4">
          {formatDate(workspace.updatedAt)}
        </p>
      </div>
    </Link>
  );
}

export default async function ProjectsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const workspaces = await getUserWorkspaces();

  // Sort by most recently updated
  const sortedWorkspaces = [...workspaces].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Projects
            </p>
            <h1 className="text-3xl font-bold text-sky-400">My Projects</h1>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted rounded-md transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" />
            My Dashboard
          </Link>
        </div>

        {/* Canvas Embed Placeholder */}
        <div className="relative rounded-xl overflow-hidden mb-10 h-[280px] bg-gradient-to-br from-sky-500 via-emerald-400 to-sky-400">
          {/* Placeholder gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-sky-500/80 via-emerald-300/60 to-sky-400/80" />

          {/* New Project Button */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Link
              href="/w/new"
              className="flex items-center gap-2 px-6 py-3 bg-white/90 hover:bg-white text-gray-900 rounded-lg font-medium shadow-lg hover:shadow-xl transition-all"
            >
              <Plus className="w-5 h-5" />
              Start New Project
            </Link>
          </div>
        </div>

        {/* Recent Projects */}
        {sortedWorkspaces.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-sky-400 mb-4">
              Recent Projects
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedWorkspaces.map((workspace) => (
                <WorkspaceCard key={workspace.id} workspace={workspace} />
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {sortedWorkspaces.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <Folder className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              No projects yet
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Create your first project to get started
            </p>
            <Link
              href="/w/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Project
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
