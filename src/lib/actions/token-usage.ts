"use server";

import { db } from "@/lib/db";
import { tokenUsage } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostCents: number;
  // Cache token stats
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCents: number;
    requestCount: number;
  }>;
  bySource: Record<string, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCents: number;
    requestCount: number;
  }>;
}

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  requestCount: number;
  // Breakdown by model (normalized names)
  byModel: Record<string, number>;
}

/**
 * Get usage summary for a workspace
 */
export async function getUsageSummary(workspaceId: string): Promise<UsageSummary> {
  const records = await db
    .select()
    .from(tokenUsage)
    .where(eq(tokenUsage.workspaceId, workspaceId));

  const summary: UsageSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCostCents: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    byModel: {},
    bySource: {},
  };

  for (const record of records) {
    summary.totalInputTokens += record.inputTokens;
    summary.totalOutputTokens += record.outputTokens;
    summary.totalTokens += record.totalTokens;
    summary.totalCostCents += record.costCents;
    summary.totalCacheCreationTokens += record.cacheCreationInputTokens ?? 0;
    summary.totalCacheReadTokens += record.cacheReadInputTokens ?? 0;

    // Aggregate by model
    if (!summary.byModel[record.model]) {
      summary.byModel[record.model] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costCents: 0,
        requestCount: 0,
      };
    }
    summary.byModel[record.model].inputTokens += record.inputTokens;
    summary.byModel[record.model].outputTokens += record.outputTokens;
    summary.byModel[record.model].totalTokens += record.totalTokens;
    summary.byModel[record.model].costCents += record.costCents;
    summary.byModel[record.model].requestCount += 1;

    // Aggregate by source
    if (!summary.bySource[record.source]) {
      summary.bySource[record.source] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costCents: 0,
        requestCount: 0,
      };
    }
    summary.bySource[record.source].inputTokens += record.inputTokens;
    summary.bySource[record.source].outputTokens += record.outputTokens;
    summary.bySource[record.source].totalTokens += record.totalTokens;
    summary.bySource[record.source].costCents += record.costCents;
    summary.bySource[record.source].requestCount += 1;
  }

  return summary;
}

/**
 * Get daily usage for a workspace over the last N days
 */
// Helper to format date as YYYY-MM-DD in local timezone
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Helper to get normalized model name for grouping
function getModelGroup(model: string): string {
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("opus")) return "Opus";
  return "Other";
}

export async function getDailyUsage(
  workspaceId: string,
  days: number = 30
): Promise<DailyUsage[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  // Get all records for this workspace
  const records = await db
    .select()
    .from(tokenUsage)
    .where(eq(tokenUsage.workspaceId, workspaceId))
    .orderBy(desc(tokenUsage.createdAt));

  // Group by date (using local timezone)
  const dailyMap = new Map<string, DailyUsage>();

  for (const record of records) {
    // Handle both Date objects and timestamps
    let createdAt: Date;
    if (record.createdAt instanceof Date) {
      createdAt = record.createdAt;
    } else if (typeof record.createdAt === "number") {
      createdAt = new Date(record.createdAt);
    } else {
      createdAt = new Date();
    }
    const date = formatLocalDate(createdAt);

    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costCents: 0,
        requestCount: 0,
        byModel: {},
      });
    }

    const daily = dailyMap.get(date)!;
    daily.inputTokens += record.inputTokens;
    daily.outputTokens += record.outputTokens;
    daily.totalTokens += record.totalTokens;
    daily.costCents += record.costCents;
    daily.requestCount += 1;

    // Track by model
    const modelGroup = getModelGroup(record.model);
    daily.byModel[modelGroup] = (daily.byModel[modelGroup] || 0) + record.totalTokens;
  }

  // Fill in missing days with zeros (using local timezone)
  const result: DailyUsage[] = [];
  const current = new Date(startDate);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  while (current <= today) {
    const dateStr = formatLocalDate(current);
    if (dailyMap.has(dateStr)) {
      result.push(dailyMap.get(dateStr)!);
    } else {
      result.push({
        date: dateStr,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costCents: 0,
        requestCount: 0,
        byModel: {},
      });
    }
    current.setDate(current.getDate() + 1);
  }

  return result;
}

/**
 * Get recent usage records for a workspace
 */
export async function getRecentUsage(
  workspaceId: string,
  limit: number = 50
) {
  return db
    .select()
    .from(tokenUsage)
    .where(eq(tokenUsage.workspaceId, workspaceId))
    .orderBy(desc(tokenUsage.createdAt))
    .limit(limit);
}
