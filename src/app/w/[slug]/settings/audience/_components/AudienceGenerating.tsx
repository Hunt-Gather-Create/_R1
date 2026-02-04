"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { Audience, AudienceMember } from "@/lib/types";

interface AudienceGeneratingProps {
  audience: Audience;
  members: AudienceMember[];
}

export function AudienceGenerating({
  audience,
  members,
}: AudienceGeneratingProps) {
  const isProcessing =
    audience.generationStatus === "pending" ||
    audience.generationStatus === "processing";
  const isCompleted = audience.generationStatus === "completed";
  const isFailed = audience.generationStatus === "failed";

  return (
    <Card className="max-w-2xl mx-auto">
      <CardContent className="pt-6">
        <div className="flex flex-col items-center text-center gap-4">
          {/* Status Icon */}
          {isProcessing && (
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          )}
          {isCompleted && (
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
            </div>
          )}
          {isFailed && (
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
            </div>
          )}

          {/* Status Text */}
          <div>
            <h3 className="font-semibold text-lg mb-2">
              {isProcessing && "Generating audience members..."}
              {isCompleted && "Generation complete!"}
              {isFailed && "Generation failed"}
            </h3>
            <p className="text-muted-foreground text-sm">
              {isProcessing && (
                <>
                  Creating 10 diverse personas based on:{" "}
                  <span className="text-foreground">
                    {audience.generationPrompt}
                  </span>
                </>
              )}
              {isCompleted &&
                `${members.length} audience members have been created.`}
              {isFailed &&
                "There was an error generating audience members. Please try again."}
            </p>
          </div>

          {/* Progress indicator */}
          {isProcessing && (
            <div className="w-full max-w-xs">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500 animate-pulse"
                  style={{ width: members.length > 0 ? "80%" : "20%" }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {members.length > 0
                  ? `${members.length} members created`
                  : "Starting generation..."}
              </p>
            </div>
          )}

          {/* Generated members preview */}
          {members.length > 0 && (
            <div className="w-full mt-4">
              <h4 className="text-sm font-medium mb-3">Generated Members</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="p-2 bg-muted/50 rounded-lg text-center"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-1 text-lg">
                      {member.name.charAt(0)}
                    </div>
                    <p className="text-xs font-medium truncate">{member.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {member.age}, {member.gender}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
