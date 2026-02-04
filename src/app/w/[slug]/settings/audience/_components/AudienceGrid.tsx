"use client";

import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";
import { AudienceMemberCard } from "./AudienceMemberCard";
import type { AudienceMember } from "@/lib/types";

interface AudienceGridProps {
  members: AudienceMember[];
  onDelete: () => void;
  isDeleting: boolean;
}

export function AudienceGrid({
  members,
  onDelete,
  isDeleting,
}: AudienceGridProps) {
  return (
    <div>
      {/* Info row */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          {members.length} audience {members.length === 1 ? "member" : "members"}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={isDeleting}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          {isDeleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
          <span className="sr-only">Delete Audience</span>
        </Button>
      </div>

      {/* Grid */}
      {members.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {members.map((member) => (
            <AudienceMemberCard key={member.id} member={member} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          No audience members found.
        </div>
      )}
    </div>
  );
}
