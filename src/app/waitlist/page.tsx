import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/actions/workspace";
import { Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WaitlistPage() {
  const user = await requireAuth();

  // If already active, send them to projects
  if (user.status === "active") {
    redirect("/projects");
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-md mx-auto px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-6">
          <Clock className="w-8 h-8 text-muted-foreground" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3">
          You&apos;re on the waitlist
        </h1>

        <p className="text-muted-foreground mb-6">
          Thanks for your interest! We&apos;re gradually opening access during
          our beta. You&apos;ll receive an invite link via email when a spot
          opens up.
        </p>

        <p className="text-sm text-muted-foreground/60">
          Already have an invite link? Click it to get started.
        </p>
      </div>
    </div>
  );
}
