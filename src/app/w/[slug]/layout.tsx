import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getWorkspaceBySlug,
  requireWorkspaceAccess,
} from "@/lib/actions/workspace";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  // Parallelize auth check and params resolution
  const [user, { slug }] = await Promise.all([getCurrentUser(), params]);

  if (!user) {
    redirect("/login");
  }

  // Get workspace by slug
  const workspace = await getWorkspaceBySlug(slug);

  if (!workspace) {
    notFound();
  }

  // Verify user has access to this workspace
  try {
    await requireWorkspaceAccess(workspace.id);
  } catch {
    // User doesn't have access - redirect to home
    redirect("/");
  }

  return <>{children}</>;
}
