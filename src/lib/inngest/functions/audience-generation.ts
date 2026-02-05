import { inngest } from "../client";
import { db } from "@/lib/db";
import { audiences, audienceMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { z } from "zod";
import { uploadContent, generateAudienceMemberStorageKey } from "@/lib/storage/r2-client";
import { generateRandomPersonaStructure, getRandomIntensity, getRandomTimeframe, type RandomPersonaStructure } from "@/lib/utils/audience-generator";
import type { BrandGuidelines } from "@/lib/types";
import { uniqueNamesGenerator, names } from "unique-names-generator";

const GENERATION_MODEL = "claude-haiku-4-5-20251001";
const MEMBERS_TO_GENERATE = 10;

// Schema for AI-generated creative content only
const aiGeneratedContentSchema = z.object({
  name: z.string(),
  occupation: z.string(),
  tagline: z.string(),
  backstory: z.string(),
  painPoints: z.array(z.object({
    category: z.string(),
    description: z.string(),
  })),
  goals: z.array(z.object({
    category: z.string(),
    description: z.string(),
  })),
  aiInstructions: z.object({
    basePrompt: z.string(),
    tone: z.array(z.string()),
    feedbackGuidelines: z.object({
      honestyCriteria: z.string(),
      focusAreas: z.array(z.string()),
    }),
    contextualBehaviors: z.object({
      whenPositive: z.string(),
      whenNegative: z.string(),
      whenConfused: z.string(),
    }),
    exampleResponses: z.array(z.object({
      scenario: z.string(),
      response: z.string(),
    })),
  }),
});

const CREATIVE_CONTENT_PROMPT = `You are a market research expert creating a realistic audience persona for a brand.

Based on the demographic profile provided, create the CREATIVE content for this persona. The structured data (demographics, psychographics, behavioral traits) has already been generated - you just need to create content that fits this profile.

DEMOGRAPHIC PROFILE (already determined):
{demographicProfile}

BRAND CONTEXT:
{brandContext}

TARGET AUDIENCE:
{generationPrompt}

Generate creative content that brings this persona to life.

IMPORTANT: The occupation MUST be age-appropriate:
- People in their 20s: entry-level to mid-level roles (e.g., Junior Developer, Marketing Coordinator, Sales Rep)
- People in their 30s: mid-level to senior roles (e.g., Senior Engineer, Marketing Manager, Team Lead)
- People in their 40s-50s: senior to executive roles (e.g., Director, VP, Senior Manager, Principal)
- People 55+: executive or highly experienced roles (e.g., CEO, Partner, Senior Consultant)

Respond with ONLY a JSON object (no markdown):
{
  "name": "A realistic full name appropriate for the demographic",
  "occupation": "A specific job title appropriate for their age and experience level",
  "tagline": "A one-sentence persona summary",
  "backstory": "2-3 sentences about their life story and current situation",
  "painPoints": [
    { "category": "Category name", "description": "Specific pain point related to what this brand might solve" },
    { "category": "Category name", "description": "Another pain point" }
  ],
  "goals": [
    { "category": "Category name", "description": "A goal that aligns with the brand's value proposition" },
    { "category": "Category name", "description": "Another goal" }
  ],
  "aiInstructions": {
    "basePrompt": "A prompt for an AI to roleplay as this persona, e.g., 'You are [Name], a [brief description]...'",
    "tone": ["adjective1", "adjective2", "adjective3"],
    "feedbackGuidelines": {
      "honestyCriteria": "How this persona gives honest feedback",
      "focusAreas": ["what they care about", "another focus"]
    },
    "contextualBehaviors": {
      "whenPositive": "How they react to things they like",
      "whenNegative": "How they react to things they dislike",
      "whenConfused": "How they handle confusion"
    },
    "exampleResponses": [
      { "scenario": "A situation", "response": "How they would naturally respond" }
    ]
  }
}

Make the persona feel like a real person, not a stereotype. Pain points should be specific and actionable. The AI instructions should capture their unique voice.`;

function formatDemographicProfile(structure: RandomPersonaStructure): string {
  const { demographics, psychographics, behavioralTraits, aiSettings } = structure;

  return `- Age: ${demographics.age} (${demographics.generation.replace(/_/g, ' ')})
- Gender: ${demographics.gender.replace(/_/g, ' ')}
- Location: ${demographics.location.region}, ${demographics.location.country} (${demographics.location.urbanicity})
- Income: ${demographics.incomeLevel.replace(/_/g, ' ')}
- Education: ${demographics.educationLevel.replace(/_/g, ' ')}
- Employment: ${demographics.employmentStatus.replace(/_/g, ' ')}
- Family: ${demographics.familyStatus.maritalStatus}${demographics.familyStatus.hasChildren ? `, ${demographics.familyStatus.numberOfChildren} children` : ', no children'}
- Values: ${psychographics.valuesOrientation.primary} (primary), ${psychographics.valuesOrientation.secondary} (secondary)
- Risk tolerance: ${psychographics.riskTolerance.replace(/_/g, ' ')}
- Decision style: ${psychographics.decisionMakingStyle}
- Brand relationship: ${psychographics.brandRelationshipStyle.replace(/_/g, ' ')}
- Media channels: ${behavioralTraits.mediaConsumption.primaryChannels.join(', ')}
- Shopping: ${behavioralTraits.shoppingBehavior.researchHabits.replace(/_/g, ' ')}, ${behavioralTraits.shoppingBehavior.pricesSensitivity.replace(/_/g, ' ')} price sensitivity
- Communication: ${behavioralTraits.communicationStyle.preferred}, ${behavioralTraits.communicationStyle.responseStyle.replace(/_/g, ' ')}
- Voice: ${aiSettings.vocabulary} vocabulary, ${aiSettings.emotionalExpression} emotional expression`;
}

function buildBrandContext(
  brandName: string,
  brandIndustry: string | undefined,
  brandGuidelines: BrandGuidelines | undefined
): string {
  let context = `Brand: ${brandName}`;

  if (brandIndustry) {
    context += `\nIndustry: ${brandIndustry}`;
  }

  if (brandGuidelines?.voiceAndTone) {
    const vt = brandGuidelines.voiceAndTone;
    if (vt.characteristics?.length) {
      context += `\nBrand Voice: ${vt.characteristics.join(", ")}`;
    }
  }

  return context;
}

export function generateUniqueFirstNames(count: number): string[] {
  const nameSet = new Set<string>();
  while (nameSet.size < count) {
    const name = uniqueNamesGenerator({ dictionaries: [names], style: "capital" });
    nameSet.add(name);
  }
  return Array.from(nameSet);
}

async function generateCreativeContent(
  structure: RandomPersonaStructure,
  brandContext: string,
  generationPrompt: string,
  assignedFirstName: string
): Promise<z.infer<typeof aiGeneratedContentSchema>> {
  const demographicProfile = formatDemographicProfile(structure);

  let prompt = CREATIVE_CONTENT_PROMPT
    .replace("{demographicProfile}", demographicProfile)
    .replace("{brandContext}", brandContext)
    .replace("{generationPrompt}", generationPrompt);

  prompt += `\n\nIMPORTANT: The persona's first name should be "${assignedFirstName}". Generate an appropriate last name that fits their cultural background and demographics. The full name should feel natural and realistic. However, if "${assignedFirstName}" does not match the persona's specified GENDER, you MUST replace it with a gender-appropriate first name that sounds similar or starts with the same letter.`;

  const result = await generateText({
    model: anthropic(GENERATION_MODEL),
    prompt,
  });

  // Parse JSON response
  const text = result.text.trim();
  let jsonText = text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonText = jsonMatch[0];
  }

  const parsed = JSON.parse(jsonText);
  return aiGeneratedContentSchema.parse(parsed);
}

function combinePersonaData(
  structure: RandomPersonaStructure,
  creative: z.infer<typeof aiGeneratedContentSchema>
) {
  const { demographics, psychographics, behavioralTraits, aiSettings } = structure;

  return {
    name: creative.name,
    tagline: creative.tagline,
    backstory: creative.backstory,
    demographics: {
      ...demographics,
      occupation: creative.occupation,
    },
    psychographics,
    behavioralTraits,
    painPoints: creative.painPoints.map((p) => ({
      ...p,
      intensity: getRandomIntensity(),
    })),
    goals: creative.goals.map((g) => ({
      ...g,
      timeframe: getRandomTimeframe(),
    })),
    aiInstructions: {
      basePrompt: creative.aiInstructions.basePrompt,
      voiceAndTone: {
        tone: creative.aiInstructions.tone,
        vocabulary: aiSettings.vocabulary,
        emotionalExpression: aiSettings.emotionalExpression,
      },
      feedbackGuidelines: creative.aiInstructions.feedbackGuidelines,
      responseFormat: {
        preferredLength: aiSettings.preferredLength,
        structurePreference: aiSettings.structurePreference,
        includeEmotions: Math.random() > 0.5,
      },
      contextualBehaviors: creative.aiInstructions.contextualBehaviors,
      exampleResponses: creative.aiInstructions.exampleResponses,
    },
  };
}

async function saveMember(
  memberData: ReturnType<typeof combinePersonaData>,
  workspaceId: string,
  audienceId: string
): Promise<string> {
  const memberId = crypto.randomUUID();
  const now = new Date();
  const storageKey = generateAudienceMemberStorageKey(workspaceId, audienceId, memberId);

  // Build full profile with IDs
  const fullProfile = {
    ...memberData,
    id: memberId,
    audienceId,
    createdAt: now.toISOString(),
  };

  // Save full profile to R2
  await uploadContent(storageKey, JSON.stringify(fullProfile, null, 2), "application/json");

  // Extract primary pain point and goal for metadata
  const primaryPainPoint = memberData.painPoints?.[0]?.description ?? null;
  const primaryGoal = memberData.goals?.[0]?.description ?? null;

  // Save lightweight metadata to DB
  await db.insert(audienceMembers).values({
    id: memberId,
    audienceId,
    name: memberData.name,
    avatar: null,
    age: memberData.demographics.age,
    gender: memberData.demographics.gender,
    occupation: memberData.demographics.occupation,
    location: `${memberData.demographics.location.region}, ${memberData.demographics.location.country}`,
    tagline: memberData.tagline,
    primaryPainPoint,
    primaryGoal,
    profileStorageKey: storageKey,
    createdAt: now,
  });

  return memberId;
}

export const generateAudienceMembers = inngest.createFunction(
  {
    id: "audience-members-generate",
    name: "Generate Audience Members",
    retries: 1,
    concurrency: {
      limit: 2,
    },
  },
  { event: "audience/members.generate" },
  async ({ event, step }) => {
    const {
      audienceId,
      workspaceId,
      brandName,
      brandIndustry,
      brandGuidelines,
      generationPrompt,
    } = event.data;

    // Parse brand guidelines if provided
    let parsedGuidelines: BrandGuidelines | undefined;
    if (brandGuidelines) {
      try {
        parsedGuidelines = JSON.parse(brandGuidelines);
      } catch {
        // Ignore parse errors
      }
    }

    const brandContext = buildBrandContext(brandName, brandIndustry, parsedGuidelines);

    // Step 1: Mark audience as processing
    await step.run("mark-processing", async () => {
      await db
        .update(audiences)
        .set({
          generationStatus: "processing",
          updatedAt: new Date(),
        })
        .where(eq(audiences.id, audienceId));

      return { status: "processing" };
    });

    // Pre-generate unique first names to avoid duplicates across parallel calls
    const uniqueFirstNames = generateUniqueFirstNames(MEMBERS_TO_GENERATE);

    // Generate all members in parallel
    const memberResults = await Promise.all(
      Array.from({ length: MEMBERS_TO_GENERATE }, (_, i) =>
        step.run(`generate-member-${i + 1}`, async () => {
          try {
            const structure = generateRandomPersonaStructure();
            const creative = await generateCreativeContent(
              structure, brandContext, generationPrompt, uniqueFirstNames[i]
            );
            const memberData = combinePersonaData(structure, creative);
            const memberId = await saveMember(memberData, workspaceId, audienceId);
            return {
              success: true as const,
              memberId,
              name: memberData.name,
            };
          } catch (error) {
            console.error(`Failed to generate member ${i + 1}:`, error);
            return {
              success: false as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        })
      )
    );

    // Collect results
    const savedMemberIds: string[] = [];
    const errors: { index: number; error: string }[] = [];
    for (let i = 0; i < memberResults.length; i++) {
      const result = memberResults[i];
      if (result.success) {
        savedMemberIds.push(result.memberId);
      } else {
        errors.push({ index: i, error: result.error });
      }
    }

    // Final step: Mark audience as completed
    const finalStatus = await step.run("mark-completed", async () => {
      const status = savedMemberIds.length === 0 ? "failed" : "completed";

      await db
        .update(audiences)
        .set({
          generationStatus: status,
          memberCount: savedMemberIds.length,
          updatedAt: new Date(),
        })
        .where(eq(audiences.id, audienceId));

      return {
        status,
        memberCount: savedMemberIds.length,
        errorCount: errors.length,
      };
    });

    return {
      audienceId,
      memberCount: savedMemberIds.length,
      memberIds: savedMemberIds,
      errors: errors.length > 0 ? errors : undefined,
      status: finalStatus.status,
    };
  }
);
