"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Palette, ArrowRight } from "lucide-react";

export function AudienceNoBrand() {
  const params = useParams<{ slug: string }>();

  return (
    <Card className="max-w-lg mx-auto">
      <CardContent className="pt-6">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Palette className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg mb-2">Set up your brand first</h3>
            <p className="text-muted-foreground text-sm">
              To create audience personas, you need to configure your brand
              identity. The audience generator uses your brand&apos;s voice,
              tone, and industry to create realistic target customers.
            </p>
          </div>
          <Button asChild>
            <Link href={`/w/${params.slug}/settings/brand`}>
              Configure Brand
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
