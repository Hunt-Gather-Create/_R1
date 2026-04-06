import { getUserProfile } from "@/lib/actions/users";
import { redirect } from "next/navigation";
import { ProfileContent } from "./_components/ProfileContent";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const profile = await getUserProfile();

  if (!profile) {
    redirect("/login");
  }

  return <ProfileContent profile={profile} />;
}
