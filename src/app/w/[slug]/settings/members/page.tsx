"use client";

import { useState } from "react";
import { UserPlus, Trash2, Shield, User, Eye } from "lucide-react";
import {
  inviteMember,
  removeMember,
  updateMemberRole,
} from "@/lib/actions/workspace";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import { useSettingsContext } from "../context";
import type { WorkspaceRole } from "@/lib/types";

const ROLE_OPTIONS: {
  value: WorkspaceRole;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "admin", label: "Admin", icon: <Shield className="w-4 h-4" /> },
  { value: "member", label: "Member", icon: <User className="w-4 h-4" /> },
  { value: "viewer", label: "Viewer", icon: <Eye className="w-4 h-4" /> },
];

export default function MembersPage() {
  const { workspace, members, currentUserId, isAdmin, refreshMembers, brand } =
    useSettingsContext();

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !inviteEmail.trim()) return;

    setIsInviting(true);
    setInviteMessage(null);

    try {
      const result = await inviteMember(
        workspace.id,
        inviteEmail.trim(),
        inviteRole
      );
      setInviteMessage({
        type: result.success ? "success" : "error",
        text: result.message,
      });

      if (result.success) {
        setInviteEmail("");
        await refreshMembers();
      }
    } catch (err) {
      setInviteMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to invite member",
      });
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!workspace) return;
    if (!confirm("Are you sure you want to remove this member?")) return;

    try {
      await removeMember(workspace.id, userId);
      await refreshMembers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleRoleChange = async (userId: string, newRole: WorkspaceRole) => {
    if (!workspace) return;

    try {
      await updateMemberRole(workspace.id, userId, newRole);
      await refreshMembers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  return (
    <GradientPage color={brand?.primaryColor ?? undefined}>
      <PageHeader
        label="Settings"
        title="Members"
        subtitle={`Manage who has access to ${workspace?.name ?? "this workspace"}`}
      />

      <section className="container">
        {/* Invite Form (admin only) */}
        {isAdmin && (
          <div className="mb-8 p-6 bg-card rounded-lg border border-border">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Invite Member
            </h2>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="flex gap-4">
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email address"
                  disabled={isInviting}
                  className="flex-1"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                  className="px-3 py-2 bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={isInviting}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="submit"
                  disabled={!inviteEmail.trim() || isInviting}
                >
                  {isInviting ? "Inviting..." : "Invite"}
                </Button>
              </div>
              {inviteMessage && (
                <div
                  className={`text-sm px-3 py-2 rounded-md ${
                    inviteMessage.type === "success"
                      ? "text-green-600 bg-green-500/10"
                      : "text-destructive bg-destructive/10"
                  }`}
                >
                  {inviteMessage.text}
                </div>
              )}
            </form>
          </div>
        )}

        {/* Members List */}
        <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {members.length} member{members.length !== 1 ? "s" : ""}
          </h2>
        </div>
        <div className="divide-y divide-border">
          {members.map((member) => {
            const isOwner = workspace?.ownerId === member.userId;
            const isSelf = member.userId === currentUserId;

            return (
              <div
                key={member.userId}
                className="settings-list-item flex items-center justify-between px-6 py-4"
              >
                <div className="flex items-center gap-3">
                  {member.user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.user.avatarUrl}
                      alt=""
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <span className="text-sm font-medium text-primary">
                        {(
                          member.user.firstName?.[0] ?? member.user.email[0]
                        ).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {member.user.firstName && member.user.lastName
                          ? `${member.user.firstName} ${member.user.lastName}`
                          : member.user.email}
                      </span>
                      {isOwner && (
                        <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                          Owner
                        </span>
                      )}
                      {isSelf && (
                        <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                          You
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {member.user.email}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isAdmin && !isOwner ? (
                    <>
                      <select
                        value={member.role}
                        onChange={(e) =>
                          handleRoleChange(
                            member.userId,
                            e.target.value as WorkspaceRole
                          )
                        }
                        className="px-2 py-1 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                      {!isSelf && (
                        <button
                          onClick={() => handleRemoveMember(member.userId)}
                          className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors"
                          title="Remove member"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground capitalize">
                      {member.role}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </section>
    </GradientPage>
  );
}
