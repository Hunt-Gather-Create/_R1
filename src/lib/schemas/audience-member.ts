import { z } from "zod";

// Helper to coerce array to single value (AI sometimes returns arrays for single-value fields)
const coerceToSingleValue = <T extends string>(enumValues: readonly [T, ...T[]]) =>
  z.preprocess(
    (val) => (Array.isArray(val) ? val[0] : val),
    z.enum(enumValues)
  );

// Helper to filter array to only valid enum values (AI sometimes returns invalid values)
const filterToValidEnumValues = <T extends string>(enumValues: readonly [T, ...T[]]) =>
  z.preprocess(
    (val) => {
      if (!Array.isArray(val)) return val;
      const validSet = new Set(enumValues as readonly string[]);
      const filtered = val.filter((v) => typeof v === "string" && validSet.has(v));
      // Return at least one value if possible, defaulting to first enum value
      return filtered.length > 0 ? filtered : [enumValues[0]];
    },
    z.array(z.enum(enumValues))
  );

// Demographics schema
export const demographicsSchema = z.object({
  age: z.number().int().describe("Age between 18-100"),
  generation: coerceToSingleValue([
    "gen_alpha",
    "gen_z",
    "millennial",
    "gen_x",
    "boomer",
    "silent",
  ] as const),
  gender: coerceToSingleValue(["male", "female", "non_binary", "prefer_not_to_say"] as const),
  incomeLevel: coerceToSingleValue(["low", "lower_middle", "middle", "upper_middle", "high"] as const),
  educationLevel: coerceToSingleValue([
    "high_school",
    "some_college",
    "associates",
    "bachelors",
    "masters",
    "doctorate",
    "trade_school",
  ] as const),
  location: z.object({
    country: z.string(),
    region: z.string(),
    urbanicity: coerceToSingleValue(["urban", "suburban", "rural"] as const),
  }),
  employmentStatus: coerceToSingleValue([
    "employed_full_time",
    "employed_part_time",
    "self_employed",
    "unemployed",
    "student",
    "retired",
    "homemaker",
  ] as const),
  familyStatus: z.object({
    maritalStatus: coerceToSingleValue(["single", "married", "divorced", "widowed", "partnered"] as const),
    hasChildren: z.boolean(),
    numberOfChildren: z.number().int().optional().describe("Number of children if hasChildren is true"),
  }),
  occupation: z.string(),
});

// Values enum (used in psychographics)
const valuesEnum = [
  "security",
  "achievement",
  "hedonism",
  "stimulation",
  "self_direction",
  "universalism",
  "benevolence",
  "tradition",
  "conformity",
  "power",
] as const;

// Psychographics schema
export const psychographicsSchema = z.object({
  valuesOrientation: z.object({
    primary: coerceToSingleValue(valuesEnum),
    secondary: coerceToSingleValue(valuesEnum),
  }),
  riskTolerance: coerceToSingleValue(["risk_averse", "cautious", "moderate", "risk_seeking"] as const),
  decisionMakingStyle: coerceToSingleValue([
    "analytical",
    "intuitive",
    "dependent",
    "avoidant",
    "spontaneous",
  ] as const),
  brandRelationshipStyle: coerceToSingleValue([
    "loyalist",
    "variety_seeker",
    "value_hunter",
    "quality_seeker",
    "trend_follower",
  ] as const),
});

// Device usage enum
const deviceEnum = ["mobile", "desktop", "tablet", "smart_tv"] as const;

// Behavioral traits schema
export const behavioralTraitsSchema = z.object({
  mediaConsumption: z.object({
    primaryChannels: z.array(z.string()).describe("1-5 primary media channels"),
    contentPreferences: z.array(z.string()).describe("1-5 content preferences"),
    deviceUsage: z.object({
      primary: coerceToSingleValue(deviceEnum),
      secondary: coerceToSingleValue(deviceEnum).optional(),
    }),
  }),
  shoppingBehavior: z.object({
    preferredChannels: filterToValidEnumValues(
      ["online_only", "in_store_only", "omnichannel", "social_commerce"] as const
    ).describe("Preferred shopping channels"),
    researchHabits: coerceToSingleValue([
      "extensive_researcher",
      "moderate_researcher",
      "impulse_buyer",
      "recommendation_seeker",
    ] as const),
    pricesSensitivity: coerceToSingleValue(["very_sensitive", "moderate", "quality_over_price"] as const),
  }),
  trustIndicators: z.object({
    trustedSources: z.array(z.string()).describe("1-5 trusted sources"),
    skepticalOf: z.array(z.string()).describe("1-5 things they're skeptical of"),
  }),
  communicationStyle: z.object({
    preferred: coerceToSingleValue(["formal", "casual", "direct", "indirect"] as const),
    responseStyle: coerceToSingleValue(["detailed", "concise", "visual", "data_driven"] as const),
  }),
});

// Pain points and goals schema
export const painPointSchema = z.object({
  category: z.string(),
  description: z.string(),
  intensity: coerceToSingleValue(["low", "medium", "high", "critical"] as const),
  currentSolutions: z.array(z.string()).optional().describe("Current solutions they use"),
});

export const goalSchema = z.object({
  category: z.string(),
  description: z.string(),
  timeframe: coerceToSingleValue(["immediate", "short_term", "medium_term", "long_term"] as const),
  barriers: z.array(z.string()).optional().describe("Barriers to achieving the goal"),
});

// AI instructions schema (for simulating persona responses)
export const aiInstructionsSchema = z.object({
  basePrompt: z.string().describe("Core prompt for simulating this persona"),
  voiceAndTone: z.object({
    tone: z.array(z.string()).describe("1-5 tone descriptors"),
    vocabulary: coerceToSingleValue(["simple", "moderate", "sophisticated"] as const),
    emotionalExpression: coerceToSingleValue(["reserved", "moderate", "expressive"] as const),
  }),
  feedbackGuidelines: z.object({
    honestyCriteria: z.string(),
    focusAreas: z.array(z.string()).describe("1-5 focus areas"),
    avoidTopics: z.array(z.string()).optional().describe("Topics to avoid"),
  }),
  responseFormat: z.object({
    preferredLength: coerceToSingleValue(["brief", "moderate", "detailed"] as const),
    structurePreference: coerceToSingleValue(["narrative", "bullet_points", "mixed"] as const),
    includeEmotions: z.boolean(),
  }),
  contextualBehaviors: z.object({
    whenPositive: z.string(),
    whenNegative: z.string(),
    whenConfused: z.string(),
  }),
  prohibitions: z.array(z.string()).optional().describe("Things to prohibit"),
  exampleResponses: z
    .array(
      z.object({
        scenario: z.string(),
        response: z.string(),
      })
    )
    .describe("1-3 example responses"),
});

// Full audience member profile schema (for generation - without id, audienceId, createdAt)
export const audienceMemberProfileGenerationSchema = z.object({
  name: z.string().describe("Full name of the persona"),
  tagline: z.string().describe("One-sentence persona summary"),
  backstory: z.string().describe("Brief life story and context"),
  demographics: demographicsSchema,
  psychographics: psychographicsSchema,
  behavioralTraits: behavioralTraitsSchema,
  painPoints: z.array(painPointSchema).describe("1-5 pain points"),
  goals: z.array(goalSchema).describe("1-5 goals"),
  aiInstructions: aiInstructionsSchema,
});

// Full audience member profile schema (includes system fields)
export const audienceMemberProfileSchema = audienceMemberProfileGenerationSchema.extend({
  id: z.string().uuid(),
  audienceId: z.string().uuid(),
  createdAt: z.string().datetime(),
});

// Type exports
export type Demographics = z.infer<typeof demographicsSchema>;
export type Psychographics = z.infer<typeof psychographicsSchema>;
export type BehavioralTraits = z.infer<typeof behavioralTraitsSchema>;
export type PainPoint = z.infer<typeof painPointSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type AIInstructions = z.infer<typeof aiInstructionsSchema>;
export type AudienceMemberProfile = z.infer<typeof audienceMemberProfileSchema>;
export type AudienceMemberProfileGeneration = z.infer<typeof audienceMemberProfileGenerationSchema>;

// Input schema for creating an audience (used by the generation API)
export const createAudienceInputSchema = z.object({
  workspaceId: z.string(),
  name: z.string().describe("Audience name, 1-100 characters"),
  description: z.string().optional().describe("Optional description, max 500 characters"),
  generationPrompt: z.string().describe("Demographic description, 10-2000 characters"),
});

export type CreateAudienceInput = z.infer<typeof createAudienceInputSchema>;

// Schema for AI-suggested demographic (from brand context)
export const suggestedDemographicSchema = z.object({
  suggestedName: z.string().describe("A name for this audience segment, e.g., 'Young Professionals'"),
  suggestedDescription: z.string().optional().describe("A brief 1-sentence description of this audience segment"),
  suggestedDemographic: z.string().describe("2-3 sentences describing the target demographic"),
  suggestedTraits: z.array(z.string()).describe("3-5 key traits that define this audience"),
});

export type SuggestedDemographic = z.infer<typeof suggestedDemographicSchema>;
