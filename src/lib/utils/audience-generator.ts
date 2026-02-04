/**
 * Random generators for audience member structured fields
 * These are generated randomly to ensure variety and avoid AI enum mistakes
 */

// Helper to pick random item from array
function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Helper to pick N random items from array
function pickRandomN<T>(arr: readonly T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// Enum values - focused on working-age generations
const GENERATIONS = ["gen_z", "millennial", "gen_x", "boomer"] as const;
const GENDERS = ["male", "female", "non_binary"] as const;
const INCOME_LEVELS = ["low", "lower_middle", "middle", "upper_middle", "high"] as const;
const EDUCATION_LEVELS = ["high_school", "some_college", "associates", "bachelors", "masters", "doctorate", "trade_school"] as const;
const URBANICITIES = ["urban", "suburban", "rural"] as const;
// Employment statuses for working-age personas (no retired)
const EMPLOYMENT_STATUSES = ["employed_full_time", "employed_part_time", "self_employed", "freelancer", "student", "homemaker"] as const;
const MARITAL_STATUSES = ["single", "married", "divorced", "widowed", "partnered"] as const;
const VALUES = ["security", "achievement", "hedonism", "stimulation", "self_direction", "universalism", "benevolence", "tradition", "conformity", "power"] as const;
const RISK_TOLERANCES = ["risk_averse", "cautious", "moderate", "risk_seeking"] as const;
const DECISION_STYLES = ["analytical", "intuitive", "dependent", "avoidant", "spontaneous"] as const;
const BRAND_STYLES = ["loyalist", "variety_seeker", "value_hunter", "quality_seeker", "trend_follower"] as const;
const DEVICES = ["mobile", "desktop", "tablet", "smart_tv"] as const;
const SHOPPING_CHANNELS = ["online_only", "in_store_only", "omnichannel", "social_commerce"] as const;
const RESEARCH_HABITS = ["extensive_researcher", "moderate_researcher", "impulse_buyer", "recommendation_seeker"] as const;
const PRICE_SENSITIVITIES = ["very_sensitive", "moderate", "quality_over_price"] as const;
const COMM_PREFERENCES = ["formal", "casual", "direct", "indirect"] as const;
const RESPONSE_STYLES = ["detailed", "concise", "visual", "data_driven"] as const;
const VOCABULARIES = ["simple", "moderate", "sophisticated"] as const;
const EMOTIONAL_EXPRESSIONS = ["reserved", "moderate", "expressive"] as const;
const PREFERRED_LENGTHS = ["brief", "moderate", "detailed"] as const;
const STRUCTURE_PREFERENCES = ["narrative", "bullet_points", "mixed"] as const;
const INTENSITIES = ["low", "medium", "high", "critical"] as const;
const TIMEFRAMES = ["immediate", "short_term", "medium_term", "long_term"] as const;

// Sample locations by region
const LOCATIONS = [
  { country: "USA", region: "California", urbanicity: "urban" },
  { country: "USA", region: "Texas", urbanicity: "suburban" },
  { country: "USA", region: "New York", urbanicity: "urban" },
  { country: "USA", region: "Florida", urbanicity: "suburban" },
  { country: "USA", region: "Colorado", urbanicity: "suburban" },
  { country: "USA", region: "Washington", urbanicity: "urban" },
  { country: "USA", region: "Oregon", urbanicity: "urban" },
  { country: "USA", region: "Arizona", urbanicity: "suburban" },
  { country: "USA", region: "Montana", urbanicity: "rural" },
  { country: "USA", region: "Vermont", urbanicity: "rural" },
  { country: "Canada", region: "Ontario", urbanicity: "urban" },
  { country: "Canada", region: "British Columbia", urbanicity: "urban" },
  { country: "UK", region: "London", urbanicity: "urban" },
  { country: "UK", region: "Manchester", urbanicity: "urban" },
  { country: "Australia", region: "Sydney", urbanicity: "urban" },
  { country: "Australia", region: "Melbourne", urbanicity: "urban" },
] as const;

// Sample media channels
const MEDIA_CHANNELS = [
  "Instagram", "TikTok", "Facebook", "LinkedIn", "Twitter/X", "YouTube",
  "Pinterest", "Reddit", "Snapchat", "Email newsletters", "Podcasts",
  "News websites", "Blogs", "TV streaming", "Print magazines"
];

// Sample content preferences
const CONTENT_PREFERENCES = [
  "educational", "inspirational", "entertaining", "informative", "how-to",
  "news", "reviews", "behind-the-scenes", "user-generated", "expert opinions",
  "data-driven", "storytelling", "quick tips", "long-form articles"
];

// Sample trusted sources
const TRUSTED_SOURCES = [
  "reviews", "word of mouth", "expert recommendations", "social proof",
  "brand reputation", "certifications", "case studies", "free trials",
  "money-back guarantees", "influencer recommendations", "news articles"
];

// Sample skepticism targets
const SKEPTICAL_OF = [
  "paid ads", "influencers", "celebrity endorsements", "too-good-to-be-true offers",
  "aggressive marketing", "hidden fees", "fine print", "sponsored content",
  "flashy promises", "unverified claims", "pushy salespeople"
];

/**
 * Generate age appropriate for a generation (working age: 22-65)
 */
function generateAgeForGeneration(generation: typeof GENERATIONS[number]): number {
  const ranges: Record<typeof GENERATIONS[number], [number, number]> = {
    gen_z: [22, 29],
    millennial: [30, 44],
    gen_x: [45, 56],
    boomer: [57, 65],
  };
  const [min, max] = ranges[generation];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate random demographics
 */
export function generateRandomDemographics() {
  const generation = pickRandom(GENERATIONS);
  const age = generateAgeForGeneration(generation);
  const hasChildren = Math.random() > 0.5;
  const location = pickRandom(LOCATIONS);

  return {
    age,
    generation,
    gender: pickRandom(GENDERS),
    incomeLevel: pickRandom(INCOME_LEVELS),
    educationLevel: pickRandom(EDUCATION_LEVELS),
    location: {
      country: location.country,
      region: location.region,
      urbanicity: pickRandom(URBANICITIES),
    },
    employmentStatus: pickRandom(EMPLOYMENT_STATUSES),
    familyStatus: {
      maritalStatus: pickRandom(MARITAL_STATUSES),
      hasChildren,
      numberOfChildren: hasChildren ? Math.floor(Math.random() * 4) + 1 : undefined,
    },
    occupation: "", // Will be filled by AI
  };
}

/**
 * Generate random psychographics
 */
export function generateRandomPsychographics() {
  const primary = pickRandom(VALUES);
  let secondary = pickRandom(VALUES);
  while (secondary === primary) {
    secondary = pickRandom(VALUES);
  }

  return {
    valuesOrientation: { primary, secondary },
    riskTolerance: pickRandom(RISK_TOLERANCES),
    decisionMakingStyle: pickRandom(DECISION_STYLES),
    brandRelationshipStyle: pickRandom(BRAND_STYLES),
  };
}

/**
 * Generate random behavioral traits
 */
export function generateRandomBehavioralTraits() {
  const primary = pickRandom(DEVICES);
  let secondary = pickRandom(DEVICES);
  while (secondary === primary) {
    secondary = pickRandom(DEVICES);
  }

  return {
    mediaConsumption: {
      primaryChannels: pickRandomN(MEDIA_CHANNELS, 3),
      contentPreferences: pickRandomN(CONTENT_PREFERENCES, 3),
      deviceUsage: { primary, secondary },
    },
    shoppingBehavior: {
      preferredChannels: pickRandomN([...SHOPPING_CHANNELS], Math.floor(Math.random() * 2) + 1),
      researchHabits: pickRandom(RESEARCH_HABITS),
      pricesSensitivity: pickRandom(PRICE_SENSITIVITIES),
    },
    trustIndicators: {
      trustedSources: pickRandomN(TRUSTED_SOURCES, 3),
      skepticalOf: pickRandomN(SKEPTICAL_OF, 2),
    },
    communicationStyle: {
      preferred: pickRandom(COMM_PREFERENCES),
      responseStyle: pickRandom(RESPONSE_STYLES),
    },
  };
}

/**
 * Generate random AI instruction settings
 */
export function generateRandomAIInstructionSettings() {
  return {
    vocabulary: pickRandom(VOCABULARIES),
    emotionalExpression: pickRandom(EMOTIONAL_EXPRESSIONS),
    preferredLength: pickRandom(PREFERRED_LENGTHS),
    structurePreference: pickRandom(STRUCTURE_PREFERENCES),
  };
}

/**
 * Get random intensity for pain points
 */
export function getRandomIntensity() {
  return pickRandom(INTENSITIES);
}

/**
 * Get random timeframe for goals
 */
export function getRandomTimeframe() {
  return pickRandom(TIMEFRAMES);
}

/**
 * Generate complete random structured data for a persona
 */
export function generateRandomPersonaStructure() {
  return {
    demographics: generateRandomDemographics(),
    psychographics: generateRandomPsychographics(),
    behavioralTraits: generateRandomBehavioralTraits(),
    aiSettings: generateRandomAIInstructionSettings(),
  };
}

export type RandomPersonaStructure = ReturnType<typeof generateRandomPersonaStructure>;
