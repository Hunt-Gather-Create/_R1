import type { WorkspaceMemberWithUser } from "@/lib/types";

/**
 * Generate initials from user name or email
 */
export function getInitials(
  firstName?: string | null,
  lastName?: string | null,
  email?: string
): string {
  if (firstName && lastName) {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  }
  if (firstName) {
    return firstName.slice(0, 2).toUpperCase();
  }
  return email?.slice(0, 2).toUpperCase() ?? "?";
}

/**
 * Get initials from a workspace member
 */
export function getMemberInitials(member: WorkspaceMemberWithUser): string {
  return getInitials(
    member.user.firstName,
    member.user.lastName,
    member.user.email
  );
}

/**
 * Get display name for a workspace member (full name or email)
 */
export function getMemberDisplayName(member: WorkspaceMemberWithUser): string {
  const { user } = member;
  if (user.firstName && user.lastName) {
    return `${user.firstName} ${user.lastName}`;
  }
  if (user.firstName) {
    return user.firstName;
  }
  return user.email;
}
