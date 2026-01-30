"use client";

import { Loader2 } from "lucide-react";

interface BrandLoadingStateProps {
  message?: string;
}

export function BrandLoadingState({ message = "Researching brand..." }: BrandLoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
