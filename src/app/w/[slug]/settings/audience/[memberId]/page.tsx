"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Briefcase,
  GraduationCap,
  Users,
  Heart,
  Brain,
  Target,
  AlertTriangle,
  MessageSquare,
  ShoppingCart,
  Tv,
} from "lucide-react";
import { getAudienceMemberAvatarUrl } from "@/lib/utils/avatar";
import { useSettingsContext } from "../../context";
import { getWorkspaceBrand, type BrandWithLogoUrl } from "@/lib/actions/brand";
import { getAudienceMemberForWorkspace } from "@/lib/actions/audience";
import type { AudienceMember } from "@/lib/types";
import type { AudienceMemberProfile } from "@/lib/schemas/audience-member";

export default function AudienceMemberPage() {
  const params = useParams<{ slug: string; memberId: string }>();
  const router = useRouter();
  const { workspace } = useSettingsContext();

  const [member, setMember] = useState<AudienceMember | null>(null);
  const [profile, setProfile] = useState<AudienceMemberProfile | null>(null);
  const [brand, setBrand] = useState<BrandWithLogoUrl | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!workspace?.id || !params.memberId) return;

      setIsLoading(true);
      setError(null);

      try {
        // Load brand for page color
        const wsBrand = await getWorkspaceBrand(workspace.id);
        setBrand(wsBrand);

        // Load member metadata (with workspace verification)
        const memberData = await getAudienceMemberForWorkspace(
          params.memberId,
          workspace.id
        );
        if (!memberData) {
          setError("Member not found");
          return;
        }
        setMember(memberData);

        // Load full profile from API (with workspace verification)
        const response = await fetch(
          `/api/audience/${params.memberId}?workspaceId=${workspace.id}`
        );
        if (!response.ok) {
          throw new Error("Failed to load profile");
        }
        const profileData = await response.json();
        setProfile(profileData);
      } catch (err) {
        console.error("Failed to load member:", err);
        setError("Failed to load member profile");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [workspace?.id, params.memberId]);

  const pageColor = brand?.primaryColor || "#8b5cf6";

  const handleBack = () => {
    router.push(`/w/${params.slug}/settings/audience`);
  };

  if (isLoading) {
    return (
      <GradientPage color={pageColor}>
        <PageHeader label="Audience" title="Loading..." />
        <div className="container py-8 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading profile...</p>
          </div>
        </div>
      </GradientPage>
    );
  }

  if (error || !member || !profile) {
    return (
      <GradientPage color={pageColor}>
        <PageHeader label="Audience" title="Error" />
        <div className="container py-8">
          <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to audience
          </Button>
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-destructive">{error || "Profile not found"}</p>
            </CardContent>
          </Card>
        </div>
      </GradientPage>
    );
  }

  const avatarUrl = getAudienceMemberAvatarUrl(member.id);

  return (
    <GradientPage color={pageColor}>
      <PageHeader
        label="Audience Member"
        title={profile.name}
        subtitle={profile.tagline}
      />
      <div className="container py-8 space-y-6">
        {/* Back button */}
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to audience
        </Button>

        {/* Profile header */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl}
                alt={profile.name}
                className="w-20 h-20 rounded-full bg-muted flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold">{profile.name}</h2>
                <p className="text-muted-foreground">{profile.tagline}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant="secondary">
                    {profile.demographics.age} years old
                  </Badge>
                  <Badge variant="secondary" className="capitalize">
                    {profile.demographics.gender.replace(/_/g, " ")}
                  </Badge>
                  <Badge variant="secondary" className="capitalize">
                    {profile.demographics.generation.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Backstory */}
            <div className="mt-4 pt-4 border-t">
              <h3 className="font-medium mb-2">Backstory</h3>
              <p className="text-sm text-muted-foreground">{profile.backstory}</p>
            </div>
          </CardContent>
        </Card>

        {/* Demographics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Demographics</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Occupation</p>
                <p className="text-sm">{profile.demographics.occupation}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="text-sm">
                  {profile.demographics.location.region},{" "}
                  {profile.demographics.location.country} (
                  {profile.demographics.location.urbanicity})
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Education</p>
                <p className="text-sm capitalize">
                  {profile.demographics.educationLevel.replace(/_/g, " ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Family</p>
                <p className="text-sm capitalize">
                  {profile.demographics.familyStatus.maritalStatus}
                  {profile.demographics.familyStatus.hasChildren &&
                    `, ${profile.demographics.familyStatus.numberOfChildren || "some"} children`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Psychographics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Psychographics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Values</p>
                <p className="text-sm capitalize">
                  Primary:{" "}
                  {profile.psychographics.valuesOrientation.primary.replace(/_/g, " ")}
                  , Secondary:{" "}
                  {profile.psychographics.valuesOrientation.secondary.replace(/_/g, " ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Decision Style</p>
                <p className="text-sm capitalize">
                  {profile.psychographics.decisionMakingStyle.replace(/_/g, " ")} |
                  Risk: {profile.psychographics.riskTolerance.replace(/_/g, " ")}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Brand Relationship</p>
              <Badge variant="outline" className="capitalize">
                {profile.psychographics.brandRelationshipStyle.replace(/_/g, " ")}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Behavioral Traits */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Behavioral Traits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Tv className="w-4 h-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Media Consumption</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {profile.behavioralTraits.mediaConsumption.primaryChannels.map(
                  (channel) => (
                    <Badge key={channel} variant="secondary" className="text-xs">
                      {channel}
                    </Badge>
                  )
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Shopping Behavior</p>
              </div>
              <p className="text-sm capitalize">
                {profile.behavioralTraits.shoppingBehavior.researchHabits.replace(/_/g, " ")}{" "}
                | Price Sensitivity:{" "}
                {profile.behavioralTraits.shoppingBehavior.pricesSensitivity.replace(/_/g, " ")}
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Communication Style</p>
              </div>
              <p className="text-sm capitalize">
                {profile.behavioralTraits.communicationStyle.preferred.replace(/_/g, " ")}{" "}
                | {profile.behavioralTraits.communicationStyle.responseStyle.replace(/_/g, " ")}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Pain Points */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Pain Points
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile.painPoints.map((painPoint, index) => (
              <div key={index} className="border-l-2 border-amber-500 pl-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{painPoint.category}</span>
                  <Badge
                    variant={painPoint.intensity === "critical" ? "destructive" : "secondary"}
                    className="text-xs"
                  >
                    {painPoint.intensity}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{painPoint.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Goals */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-green-500" />
              Goals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile.goals.map((goal, index) => (
              <div key={index} className="border-l-2 border-green-500 pl-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{goal.category}</span>
                  <Badge variant="secondary" className="text-xs capitalize">
                    {goal.timeframe.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{goal.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* AI Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Persona Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Base Prompt</p>
              <p className="text-sm bg-muted/50 p-3 rounded-md">
                {profile.aiInstructions.basePrompt}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Voice & Tone</p>
              <div className="flex flex-wrap gap-1">
                {profile.aiInstructions.voiceAndTone.tone.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
            {profile.aiInstructions.exampleResponses.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Example Responses</p>
                {profile.aiInstructions.exampleResponses.map((example, index) => (
                  <div key={index} className="bg-muted/50 p-3 rounded-md mb-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Scenario: {example.scenario}
                    </p>
                    <p className="text-sm">{example.response}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GradientPage>
  );
}
