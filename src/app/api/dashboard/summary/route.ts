import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { getWorkspaceSummaryContext, type TimeRange } from "@/lib/actions/dashboard";
import { recordTokenUsage } from "@/lib/token-usage";
import { getCurrentUser } from "@/lib/auth";

export const maxDuration = 30;

const VALID_TIME_RANGES: TimeRange[] = ["day", "week", "month"];

const SUMMARY_SYSTEM_PROMPT = `You are a workspace digest assistant. Given workspace context (issues, activities, team members), produce a concise digest.

Structure your response with these sections using markdown headers:

### Tickets in Motion
What changed recently - reference tickets by their identifier (e.g., ABC-12). Focus on status changes, new issues, and completed work.

### Team Activity
Who's working on what - attribute work to team members by name.

### Action Items & Blockers
Potential issues needing attention - overdue items, stalled tickets, or bottlenecks.

Rules:
- Target 150-250 words total
- Be factual - only reference data provided in context
- Use identifiers when mentioning tickets
- If there's minimal activity, say so briefly rather than padding with filler
- Do not use emojis`;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const timeRange = VALID_TIME_RANGES.includes(body?.timeRange) ? (body.timeRange as TimeRange) : "";

  if (!workspaceId || !timeRange) {
    return new Response("Missing or invalid workspaceId or timeRange", { status: 400 });
  }

  const context = await getWorkspaceSummaryContext(workspaceId, timeRange);

  const contextMessage = [
    `Workspace: ${context.workspace.name} (${context.workspace.purpose})`,
    "",
    `Team Members: ${context.members.map((m) => `${m.name} (${m.role})`).join(", ")}`,
    "",
    `## Issues (${context.issues.length} total)`,
    ...context.issues.map(
      (i) =>
        `- ${i.identifier}: "${i.title}" [${i.status}] priority=${i.priority} assignee=${i.assignee} column=${i.column}`
    ),
    "",
    `## Recent Activities (${context.activities.length} in time range)`,
    ...context.activities.map(
      (a) =>
        `- [${a.createdAt}] ${a.userName} ${a.type} ${a.issueIdentifier}${a.data ? ` (${a.data})` : ""}`
    ),
  ].join("\n");

  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: contextMessage,
    providerOptions: {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
    },
  });

  // Track tokens asynchronously
  Promise.resolve(result.totalUsage)
    .then((usage) => {
      const details = (usage as typeof usage & {
        inputTokenDetails?: {
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
      }).inputTokenDetails;

      recordTokenUsage({
        workspaceId,
        model: "claude-haiku-4-5-20251001",
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheCreationInputTokens: details?.cacheWriteTokens ?? 0,
        cacheReadInputTokens: details?.cacheReadTokens ?? 0,
        source: "dashboard-summary",
      }).catch((error) => {
        console.error("Failed to record token usage:", error);
      });
    })
    .catch((error) => {
      console.error("Failed to get token usage:", error);
    });

  return result.toTextStreamResponse();
}
