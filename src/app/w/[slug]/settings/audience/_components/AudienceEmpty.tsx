"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UsersRound, Plus } from "lucide-react";

interface AudienceEmptyProps {
  onCreateClick: () => void;
}

export function AudienceEmpty({ onCreateClick }: AudienceEmptyProps) {
  return (
    <Card className="max-w-lg mx-auto">
      <CardContent className="pt-6">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <UsersRound className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2">
              Create your first audience
            </h3>
            <p className="text-muted-foreground text-sm">
              Generate AI-powered virtual audience members based on your target
              demographic. Use them to test content, messaging, and marketing
              campaigns.
            </p>
          </div>
          <Button onClick={onCreateClick}>
            <Plus className="w-4 h-4 mr-1" />
            Create Audience
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
