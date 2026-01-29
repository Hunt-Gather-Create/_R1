import { type UIMessage, tool } from "ai";
import { z } from "zod";
import { createChatResponse } from "@/lib/chat";
import { getCurrentUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { WorkspaceSoul } from "@/lib/types";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are helping a user configure their workspace's AI persona. The persona defines how the workspace's AI assistant behaves, its name, goals, and interaction style.

**Your role:**
You're having a conversation to understand what kind of AI assistant the user wants for their workspace. Based on their responses, you'll configure the persona using the available tools.

**Configuration tools available:**
- setSoulName: Set the AI's name
- setSoulPersonality: Set the personality description
- setPrimaryGoals: Set the main objectives (3-5 goals)
- setTone: Set the communication tone (professional, friendly, casual, formal)
- setResponseLength: Set how detailed responses should be (concise, moderate, detailed)
- setDomainExpertise: Set areas of expertise
- addTerminology: Add domain-specific terms and definitions
- setDoRules: Set things the AI SHOULD do
- setDontRules: Set things the AI should NOT do
- setGreeting: Set an optional custom greeting

**Conversation flow:**
1. Acknowledge their initial description and what you understand
2. Ask about what they'd like to name their AI assistant (suggest 2-3 options based on the domain)
3. Ask about communication style preference (formal/casual, brief/detailed)
4. Ask about the primary goals and what the AI should focus on
5. Ask about any specific behaviors they want (do's and don'ts)
6. Configure the persona using the tools as you learn their preferences
7. Summarize the final configuration and ask if they want to adjust anything

**Guidelines:**
- Be conversational and friendly
- Configure values using tools as soon as you have enough information (don't wait until the end)
- Suggest relevant options based on the workspace's domain
- Keep the conversation focused and efficient
- After each tool call, briefly acknowledge what you've configured`;

// Schema definitions for soul configuration tools
const setSoulNameSchema = z.object({
  name: z.string().describe("The name for the AI assistant"),
});

const setSoulPersonalitySchema = z.object({
  personality: z.string().describe("A description of the AI's personality and interaction style"),
});

const setPrimaryGoalsSchema = z.object({
  goals: z.array(z.string()).min(1).max(5).describe("The main objectives for the AI (3-5 goals)"),
});

const setToneSchema = z.object({
  tone: z.enum(["professional", "friendly", "casual", "formal"]).describe("The communication tone"),
});

const setResponseLengthSchema = z.object({
  responseLength: z.enum(["concise", "moderate", "detailed"]).describe("How detailed responses should be"),
});

const setDomainExpertiseSchema = z.object({
  expertise: z.array(z.string()).describe("Areas of expertise for the AI"),
});

const addTerminologySchema = z.object({
  term: z.string().describe("The term to define"),
  definition: z.string().describe("The definition of the term"),
});

const setDoRulesSchema = z.object({
  rules: z.array(z.string()).describe("Things the AI SHOULD do"),
});

const setDontRulesSchema = z.object({
  rules: z.array(z.string()).describe("Things the AI should NOT do"),
});

const setGreetingSchema = z.object({
  greeting: z.string().describe("A custom greeting message"),
});

function createSoulTools() {
  return {
    setSoulName: tool({
      description: "Set the name for the AI assistant (e.g., 'Luna', 'Atlas', 'Sage')",
      inputSchema: setSoulNameSchema,
      execute: async ({ name }) => ({
        success: true,
        action: "setSoulName",
        name,
      }),
    }),
    setSoulPersonality: tool({
      description: "Set the personality description for the AI",
      inputSchema: setSoulPersonalitySchema,
      execute: async ({ personality }) => ({
        success: true,
        action: "setSoulPersonality",
        personality,
      }),
    }),
    setPrimaryGoals: tool({
      description: "Set the main objectives for the AI (what it should focus on helping with)",
      inputSchema: setPrimaryGoalsSchema,
      execute: async ({ goals }) => ({
        success: true,
        action: "setPrimaryGoals",
        goals,
      }),
    }),
    setTone: tool({
      description: "Set the communication tone for the AI",
      inputSchema: setToneSchema,
      execute: async ({ tone }) => ({
        success: true,
        action: "setTone",
        tone,
      }),
    }),
    setResponseLength: tool({
      description: "Set how detailed the AI's responses should be",
      inputSchema: setResponseLengthSchema,
      execute: async ({ responseLength }) => ({
        success: true,
        action: "setResponseLength",
        responseLength,
      }),
    }),
    setDomainExpertise: tool({
      description: "Set the areas of expertise for the AI",
      inputSchema: setDomainExpertiseSchema,
      execute: async ({ expertise }) => ({
        success: true,
        action: "setDomainExpertise",
        expertise,
      }),
    }),
    addTerminology: tool({
      description: "Add a domain-specific term and its definition",
      inputSchema: addTerminologySchema,
      execute: async ({ term, definition }) => ({
        success: true,
        action: "addTerminology",
        term,
        definition,
      }),
    }),
    setDoRules: tool({
      description: "Set the list of things the AI SHOULD do",
      inputSchema: setDoRulesSchema,
      execute: async ({ rules }) => ({
        success: true,
        action: "setDoRules",
        rules,
      }),
    }),
    setDontRules: tool({
      description: "Set the list of things the AI should NOT do",
      inputSchema: setDontRulesSchema,
      execute: async ({ rules }) => ({
        success: true,
        action: "setDontRules",
        rules,
      }),
    }),
    setGreeting: tool({
      description: "Set a custom greeting message for the AI",
      inputSchema: setGreetingSchema,
      execute: async ({ greeting }) => ({
        success: true,
        action: "setGreeting",
        greeting,
      }),
    }),
  };
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messages, currentSoul, workspaceId } = (await req.json()) as {
    messages: UIMessage[];
    currentSoul?: WorkspaceSoul;
    workspaceId?: string;
  };

  // Build context about current soul configuration
  let soulContext = "";
  if (currentSoul) {
    const configuredFields: string[] = [];

    if (currentSoul.name) {
      configuredFields.push(`Name: "${currentSoul.name}"`);
    }
    if (currentSoul.personality) {
      configuredFields.push(`Personality: "${currentSoul.personality}"`);
    }
    if (currentSoul.primaryGoals.length > 0) {
      configuredFields.push(`Goals: ${currentSoul.primaryGoals.join(", ")}`);
    }
    if (currentSoul.tone) {
      configuredFields.push(`Tone: ${currentSoul.tone}`);
    }
    if (currentSoul.responseLength) {
      configuredFields.push(`Response Length: ${currentSoul.responseLength}`);
    }
    if (currentSoul.domainExpertise.length > 0) {
      configuredFields.push(`Expertise: ${currentSoul.domainExpertise.join(", ")}`);
    }
    if (Object.keys(currentSoul.terminology).length > 0) {
      const terms = Object.entries(currentSoul.terminology)
        .map(([term, def]) => `${term}: ${def}`)
        .join("; ");
      configuredFields.push(`Terminology: ${terms}`);
    }
    if (currentSoul.doRules.length > 0) {
      configuredFields.push(`Do Rules: ${currentSoul.doRules.join("; ")}`);
    }
    if (currentSoul.dontRules.length > 0) {
      configuredFields.push(`Don't Rules: ${currentSoul.dontRules.join("; ")}`);
    }
    if (currentSoul.greeting) {
      configuredFields.push(`Greeting: "${currentSoul.greeting}"`);
    }

    if (configuredFields.length > 0) {
      soulContext = `\n\n**Current persona configuration:**\n${configuredFields.join("\n")}`;
    }
  }

  const tools = createSoulTools();

  return createChatResponse(messages, {
    system: SYSTEM_PROMPT + soulContext,
    tools,
    maxSteps: 10,
    workspaceId,
    usageSource: "soul",
  });
}
