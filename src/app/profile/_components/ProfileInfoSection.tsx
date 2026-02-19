"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useUpdateUserProfile } from "@/lib/hooks/use-profile";
import { toast } from "sonner";
import { SettingsRow } from "./SettingsRow";
import type { UserProfileWithWorkspaces } from "@/lib/types";

interface ProfileInfoSectionProps {
  profile: UserProfileWithWorkspaces;
}

export function ProfileInfoSection({ profile }: ProfileInfoSectionProps) {
  const [role, setRole] = useState(profile.role ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const mutation = useUpdateUserProfile();

  const hasChanges = role !== (profile.role ?? "") || bio !== (profile.bio ?? "");

  const handleSave = async () => {
    const result = await mutation.mutateAsync({
      role: role || null,
      bio: bio || null,
    });

    if (result.success) {
      toast.success("Profile info updated");
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-foreground mb-3">Profile Info</h3>
      <div className="rounded-lg border border-border bg-card">
        <SettingsRow label="Role" description="Your job title or role">
          <Input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Developer, Designer, PM"
          />
        </SettingsRow>
        <div className="px-6 py-4">
          <div className="mb-2">
            <div className="text-sm font-medium text-foreground">Bio</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Used by AI to personalize interactions
            </div>
          </div>
          <Textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A brief bio about yourself..."
            className="min-h-[200px]"
          />
        </div>
      </div>
      <div className="flex justify-end mt-4">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || mutation.isPending}
        >
          {mutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
