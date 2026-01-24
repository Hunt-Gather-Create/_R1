import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserDefaultWorkspace } from "@/lib/actions/workspace";

/**
 * Home page - redirects authenticated users to their default workspace.
 */
export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  // Get user's default workspace
  const defaultWorkspace = await getUserDefaultWorkspace();

  if (defaultWorkspace) {
    redirect(`/w/${defaultWorkspace.slug}`);
  } else {
    redirect("/w/new");
  }
}
