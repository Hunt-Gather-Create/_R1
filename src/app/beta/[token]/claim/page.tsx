import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { validateInviteCode } from "@/lib/actions/invite-codes";
import { syncUserFromWorkOS } from "@/lib/actions/users";
import { ClaimCard } from "./_components/ClaimCard";

interface ClaimPageProps {
  params: Promise<{ token: string }>;
}

export default async function ClaimPage({ params }: ClaimPageProps) {
  const { token } = await params;

  // Validate the invite code
  const { valid, errorMessage } = await validateInviteCode(token);

  // Check if user is authenticated
  const authUser = await getCurrentUser();
  let isAuthenticated = false;

  if (authUser) {
    isAuthenticated = true;
    // Sync to DB to get status
    const dbUser = await syncUserFromWorkOS({
      id: authUser.id,
      email: authUser.email,
      firstName: authUser.firstName ?? null,
      lastName: authUser.lastName ?? null,
      avatarUrl: authUser.profilePictureUrl ?? null,
    });

    if (dbUser.status === "active") {
      redirect("/projects");
    }
  }

  return (
    <ClaimCard
      token={token}
      isValid={valid}
      errorMessage={errorMessage}
      isAuthenticated={isAuthenticated}
    />
  );
}
