import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireAuth } from "@/lib/actions/workspace";

export const dynamic = "force-dynamic";

/**
 * Home page - redirects authenticated users to the projects listing.
 * Handles returnTo cookie for invite code claim flow.
 */
export default async function Home() {
  const user = await requireAuth();

  // Check for returnTo cookie (set during invite claim → login flow)
  // This must happen before the active-user check so waitlisted users
  // can be redirected to the claim page after signing in.
  // Note: cookies can only be read here, not modified (Server Component).
  // The cookie has a short maxAge (10min) so it self-expires.
  const cookieStore = await cookies();
  const returnTo = cookieStore.get("returnTo")?.value;

  if (returnTo?.startsWith("/beta/") || returnTo?.startsWith("/invite/")) {
    redirect(returnTo);
  }

  // Gate non-active users to waitlist
  if (user.status !== "active") {
    redirect("/waitlist");
  }

  redirect("/projects");
}
