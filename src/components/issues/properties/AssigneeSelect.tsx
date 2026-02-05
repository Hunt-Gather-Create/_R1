"use client";

import { UserCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getMemberInitials, getMemberDisplayName } from "@/lib/utils/member-utils";
import type { WorkspaceMemberWithUser } from "@/lib/types";

interface AssigneeSelectProps {
  value: string | null;
  members: WorkspaceMemberWithUser[];
  onChange: (userId: string | null) => void;
  className?: string;
}

export function AssigneeSelect({
  value,
  members,
  onChange,
  className,
}: AssigneeSelectProps) {
  const selectedMember = members.find((m) => m.userId === value);

  return (
    <Select
      value={value ?? "unassigned"}
      onValueChange={(v) => onChange(v === "unassigned" ? null : v)}
    >
      <SelectTrigger className={cn("w-[180px] h-8 text-xs", className)}>
        <SelectValue>
          {selectedMember ? (
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage src={selectedMember.user.avatarUrl ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {getMemberInitials(selectedMember)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{getMemberDisplayName(selectedMember)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <UserCircle className="h-5 w-5" />
              <span>Unassigned</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unassigned">
          <div className="flex items-center gap-2 text-muted-foreground">
            <UserCircle className="h-5 w-5" />
            <span>Unassigned</span>
          </div>
        </SelectItem>
        {members.map((member) => (
          <SelectItem key={member.userId} value={member.userId}>
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage src={member.user.avatarUrl ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {getMemberInitials(member)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{getMemberDisplayName(member)}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
