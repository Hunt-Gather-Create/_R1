"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Briefcase, Target, AlertTriangle } from "lucide-react";
import { getAudienceMemberAvatarUrl } from "@/lib/utils/avatar";
import type { AudienceMember } from "@/lib/types";

interface AudienceMemberCardProps {
  member: AudienceMember;
}

export function AudienceMemberCard({ member }: AudienceMemberCardProps) {
  const params = useParams<{ slug: string }>();
  const avatarUrl = getAudienceMemberAvatarUrl(member.id);

  return (
    <Link href={`/w/${params.slug}/settings/audience/${member.id}`}>
      <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
      <CardContent className="p-4">
        {/* Header with avatar and name */}
        <div className="flex items-start gap-3 mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl}
            alt={member.name}
            className="w-12 h-12 rounded-full bg-muted flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate">{member.name}</h3>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{member.age}</span>
              <span>•</span>
              <span className="capitalize">{member.gender}</span>
            </div>
          </div>
        </div>

        {/* Tagline */}
        {member.tagline && (
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
            {member.tagline}
          </p>
        )}

        {/* Details */}
        <div className="space-y-1.5">
          {member.occupation && (
            <div className="flex items-center gap-2 text-xs">
              <Briefcase className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{member.occupation}</span>
            </div>
          )}
          {member.location && (
            <div className="flex items-center gap-2 text-xs">
              <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{member.location}</span>
            </div>
          )}
        </div>

        {/* Pain point and goal badges */}
        <div className="mt-3 space-y-2">
          {member.primaryPainPoint && (
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground line-clamp-1">
                {member.primaryPainPoint}
              </p>
            </div>
          )}
          {member.primaryGoal && (
            <div className="flex items-start gap-1.5">
              <Target className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground line-clamp-1">
                {member.primaryGoal}
              </p>
            </div>
          )}
        </div>
      </CardContent>
      </Card>
    </Link>
  );
}
