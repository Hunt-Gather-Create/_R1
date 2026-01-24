"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, UserPlus, Trash2, Shield, User, Eye } from "lucide-react";
import {
  getWorkspaceBySlug,
  getWorkspaceMembers,
  inviteMember,
  removeMember,
  updateMemberRole,
} from "@/lib/actions/workspace";
import { getCurrentUserId } from "@/lib/auth";
import type { Workspace, WorkspaceMemberWithUser, WorkspaceRole } from "@/lib/types";

const ROLE_OPTIONS: { value: WorkspaceRole; label: string; icon: React.ReactNode }[] = [
  { value: "admin", label: "Admin", icon: <Shield className="w-4 h-4" /> },
  { value: "member", label: "Member", icon: <User className="w-4 h-4" /> },
  { value: "viewer", label: "Viewer", icon: <Eye className="w-4 h-4" /> },
];

export default function MembersPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberWithUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const userId = await getCurrentUserId();
        setCurrentUserId(userId);

        const ws = await getWorkspaceBySlug(params.slug);
        if (!ws) {
          setError("Workspace not found");
          return;
        }
        setWorkspace(ws);

        const wsMembers = await getWorkspaceMembers(ws.id);
        setMembers(wsMembers);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [params.slug]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !inviteEmail.trim()) return;

    setIsInviting(true);
    setInviteMessage(null);

    try {
      const result = await inviteMember(workspace.id, inviteEmail.trim(), inviteRole);
      setInviteMessage({
        type: result.success ? "success" : "error",
        text: result.message,
      });

      if (result.success) {
        setInviteEmail("");
        // Refresh members list
        const wsMembers = await getWorkspaceMembers(workspace.id);
        setMembers(wsMembers);
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
      setMembers(members.filter((m) => m.userId !== userId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleRoleChange = async (userId: string, newRole: WorkspaceRole) => {
    if (!workspace) return;

    try {
      await updateMemberRole(workspace.id, userId, newRole);
      setMembers(
        members.map((m) =>
          m.userId === userId ? { ...m, role: newRole } : m
        )
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  // Check if current user is admin
  const currentMember = members.find((m) => m.userId === currentUserId);
  const isAdmin = currentMember?.role === "admin";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-foreground mb-2">Error</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push(`/w/${params.slug}`)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to workspace
          </button>
          <h1 className="text-2xl font-bold text-foreground">Members</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage who has access to {workspace?.name}
          </p>
        </div>

        {/* Invite Form (admin only) */}
        {isAdmin && (
          <div className="mb-8 p-6 bg-card rounded-lg border border-border">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Invite Member
            </h2>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="flex gap-4">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email address"
                  className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={isInviting}
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
                <button
                  type="submit"
                  disabled={!inviteEmail.trim() || isInviting}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isInviting ? "Inviting..." : "Invite"}
                </button>
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
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div className="flex items-center gap-3">
                    {member.user.avatarUrl ? (
                      <img
                        src={member.user.avatarUrl}
                        alt=""
                        className="w-10 h-10 rounded-full"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <span className="text-sm font-medium text-primary">
                          {(member.user.firstName?.[0] ?? member.user.email[0]).toUpperCase()}
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
                            handleRoleChange(member.userId, e.target.value as WorkspaceRole)
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
      </div>
    </div>
  );
}
