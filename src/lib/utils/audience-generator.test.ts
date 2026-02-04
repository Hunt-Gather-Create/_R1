import { describe, it, expect } from "vitest";
import {
  generateRandomDemographics,
  generateRandomPsychographics,
  generateRandomBehavioralTraits,
  generateRandomAIInstructionSettings,
  generateRandomPersonaStructure,
  getRandomIntensity,
  getRandomTimeframe,
} from "./audience-generator";

describe("audience-generator utilities", () => {
  describe("generateRandomDemographics", () => {
    it("generates valid demographics with all required fields", () => {
      const demographics = generateRandomDemographics();

      expect(demographics).toHaveProperty("age");
      expect(demographics).toHaveProperty("generation");
      expect(demographics).toHaveProperty("gender");
      expect(demographics).toHaveProperty("incomeLevel");
      expect(demographics).toHaveProperty("educationLevel");
      expect(demographics).toHaveProperty("location");
      expect(demographics).toHaveProperty("employmentStatus");
      expect(demographics).toHaveProperty("familyStatus");
      expect(demographics).toHaveProperty("occupation");
    });

    it("generates age within working age range (22-65)", () => {
      for (let i = 0; i < 20; i++) {
        const demographics = generateRandomDemographics();
        expect(demographics.age).toBeGreaterThanOrEqual(22);
        expect(demographics.age).toBeLessThanOrEqual(65);
      }
    });

    it("generates valid generation values", () => {
      const validGenerations = [
        "gen_z",
        "millennial",
        "gen_x",
        "boomer",
      ];
      for (let i = 0; i < 20; i++) {
        const demographics = generateRandomDemographics();
        expect(validGenerations).toContain(demographics.generation);
      }
    });

    it("generates valid gender values", () => {
      const validGenders = ["male", "female", "non_binary"];
      for (let i = 0; i < 20; i++) {
        const demographics = generateRandomDemographics();
        expect(validGenders).toContain(demographics.gender);
      }
    });

    it("generates location with country, region, and urbanicity", () => {
      const demographics = generateRandomDemographics();
      expect(demographics.location).toHaveProperty("country");
      expect(demographics.location).toHaveProperty("region");
      expect(demographics.location).toHaveProperty("urbanicity");
      expect(["urban", "suburban", "rural"]).toContain(
        demographics.location.urbanicity
      );
    });

    it("generates valid family status", () => {
      const demographics = generateRandomDemographics();
      expect(demographics.familyStatus).toHaveProperty("maritalStatus");
      expect(demographics.familyStatus).toHaveProperty("hasChildren");
      expect(typeof demographics.familyStatus.hasChildren).toBe("boolean");

      if (demographics.familyStatus.hasChildren) {
        expect(demographics.familyStatus.numberOfChildren).toBeGreaterThan(0);
      }
    });
  });

  describe("generateRandomPsychographics", () => {
    it("generates valid psychographics with all required fields", () => {
      const psychographics = generateRandomPsychographics();

      expect(psychographics).toHaveProperty("valuesOrientation");
      expect(psychographics).toHaveProperty("riskTolerance");
      expect(psychographics).toHaveProperty("decisionMakingStyle");
      expect(psychographics).toHaveProperty("brandRelationshipStyle");
    });

    it("generates different primary and secondary values", () => {
      for (let i = 0; i < 20; i++) {
        const psychographics = generateRandomPsychographics();
        expect(psychographics.valuesOrientation.primary).not.toBe(
          psychographics.valuesOrientation.secondary
        );
      }
    });

    it("generates valid risk tolerance values", () => {
      const validValues = ["risk_averse", "cautious", "moderate", "risk_seeking"];
      for (let i = 0; i < 20; i++) {
        const psychographics = generateRandomPsychographics();
        expect(validValues).toContain(psychographics.riskTolerance);
      }
    });

    it("generates valid decision making styles", () => {
      const validStyles = [
        "analytical",
        "intuitive",
        "dependent",
        "avoidant",
        "spontaneous",
      ];
      for (let i = 0; i < 20; i++) {
        const psychographics = generateRandomPsychographics();
        expect(validStyles).toContain(psychographics.decisionMakingStyle);
      }
    });
  });

  describe("generateRandomBehavioralTraits", () => {
    it("generates valid behavioral traits with all required fields", () => {
      const traits = generateRandomBehavioralTraits();

      expect(traits).toHaveProperty("mediaConsumption");
      expect(traits).toHaveProperty("shoppingBehavior");
      expect(traits).toHaveProperty("trustIndicators");
      expect(traits).toHaveProperty("communicationStyle");
    });

    it("generates media consumption with channels and preferences", () => {
      const traits = generateRandomBehavioralTraits();

      expect(Array.isArray(traits.mediaConsumption.primaryChannels)).toBe(true);
      expect(traits.mediaConsumption.primaryChannels.length).toBe(3);
      expect(Array.isArray(traits.mediaConsumption.contentPreferences)).toBe(
        true
      );
      expect(traits.mediaConsumption.contentPreferences.length).toBe(3);
    });

    it("generates device usage with different primary and secondary", () => {
      for (let i = 0; i < 20; i++) {
        const traits = generateRandomBehavioralTraits();
        expect(traits.mediaConsumption.deviceUsage.primary).not.toBe(
          traits.mediaConsumption.deviceUsage.secondary
        );
      }
    });

    it("generates valid shopping behavior", () => {
      const validResearchHabits = [
        "extensive_researcher",
        "moderate_researcher",
        "impulse_buyer",
        "recommendation_seeker",
      ];
      const validPriceSensitivity = [
        "very_sensitive",
        "moderate",
        "quality_over_price",
      ];

      for (let i = 0; i < 20; i++) {
        const traits = generateRandomBehavioralTraits();
        expect(validResearchHabits).toContain(
          traits.shoppingBehavior.researchHabits
        );
        expect(validPriceSensitivity).toContain(
          traits.shoppingBehavior.pricesSensitivity
        );
      }
    });

    it("generates trust indicators with arrays", () => {
      const traits = generateRandomBehavioralTraits();

      expect(Array.isArray(traits.trustIndicators.trustedSources)).toBe(true);
      expect(traits.trustIndicators.trustedSources.length).toBe(3);
      expect(Array.isArray(traits.trustIndicators.skepticalOf)).toBe(true);
      expect(traits.trustIndicators.skepticalOf.length).toBe(2);
    });
  });

  describe("generateRandomAIInstructionSettings", () => {
    it("generates valid AI instruction settings", () => {
      const settings = generateRandomAIInstructionSettings();

      expect(settings).toHaveProperty("vocabulary");
      expect(settings).toHaveProperty("emotionalExpression");
      expect(settings).toHaveProperty("preferredLength");
      expect(settings).toHaveProperty("structurePreference");
    });

    it("generates valid vocabulary values", () => {
      const validValues = ["simple", "moderate", "sophisticated"];
      for (let i = 0; i < 20; i++) {
        const settings = generateRandomAIInstructionSettings();
        expect(validValues).toContain(settings.vocabulary);
      }
    });

    it("generates valid structure preferences", () => {
      const validValues = ["narrative", "bullet_points", "mixed"];
      for (let i = 0; i < 20; i++) {
        const settings = generateRandomAIInstructionSettings();
        expect(validValues).toContain(settings.structurePreference);
      }
    });
  });

  describe("generateRandomPersonaStructure", () => {
    it("generates complete persona structure with all sections", () => {
      const persona = generateRandomPersonaStructure();

      expect(persona).toHaveProperty("demographics");
      expect(persona).toHaveProperty("psychographics");
      expect(persona).toHaveProperty("behavioralTraits");
      expect(persona).toHaveProperty("aiSettings");
    });

    it("generates diverse personas across multiple calls", () => {
      const personas = Array.from({ length: 10 }, () =>
        generateRandomPersonaStructure()
      );

      // Check that we get some variety in demographics
      const ages = new Set(personas.map((p) => p.demographics.age));
      const genders = new Set(personas.map((p) => p.demographics.gender));

      // With 10 personas, we should see some variety
      expect(ages.size).toBeGreaterThan(1);
      expect(genders.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getRandomIntensity", () => {
    it("returns valid intensity values", () => {
      const validIntensities = ["low", "medium", "high", "critical"];
      for (let i = 0; i < 20; i++) {
        const intensity = getRandomIntensity();
        expect(validIntensities).toContain(intensity);
      }
    });
  });

  describe("getRandomTimeframe", () => {
    it("returns valid timeframe values", () => {
      const validTimeframes = [
        "immediate",
        "short_term",
        "medium_term",
        "long_term",
      ];
      for (let i = 0; i < 20; i++) {
        const timeframe = getRandomTimeframe();
        expect(validTimeframes).toContain(timeframe);
      }
    });
  });
});
