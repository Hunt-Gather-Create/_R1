import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getWorkspaceBySlug,
  requireWorkspaceAccess,
} from "@/lib/actions/workspace";
import { isNextSentinelError } from "@/lib/utils/is-next-sentinel-error";

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
  } catch (error) {
    // Re-throw Next.js internal sentinel errors (DYNAMIC_SERVER_USAGE,
    // NEXT_REDIRECT, NEXT_NOT_FOUND, NEXT_HTTP_ERROR_FALLBACK, etc.)
    // so Next's static-bailout / control-flow mechanisms work correctly.
    if (isNextSentinelError(error)) {
      throw error;
    }
    // User doesn't have access - redirect to home
    redirect("/");
  }

  return <>{children}</>;
}
