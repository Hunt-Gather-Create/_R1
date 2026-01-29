"use server";

import { db } from "@/lib/db";
import { tokenUsage } from "@/lib/db/schema";
import { eq, sql, and, gte, desc } from "drizzle-orm";

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostCents: number;
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
    byModel: {},
    bySource: {},
  };

  for (const record of records) {
    summary.totalInputTokens += record.inputTokens;
    summary.totalOutputTokens += record.outputTokens;
    summary.totalTokens += record.totalTokens;
    summary.totalCostCents += record.costCents;

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
export async function getDailyUsage(
  workspaceId: string,
  days: number = 30
): Promise<DailyUsage[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  // Get all records for this workspace (not filtering by date for now to debug)
  const records = await db
    .select()
    .from(tokenUsage)
    .where(eq(tokenUsage.workspaceId, workspaceId))
    .orderBy(desc(tokenUsage.createdAt));

  console.log("getDailyUsage: Found", records.length, "records for workspace", workspaceId);
  if (records.length > 0) {
    console.log("First record:", records[0]);
  }

  // Group by date
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
    const date = createdAt.toISOString().split("T")[0];

    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costCents: 0,
        requestCount: 0,
      });
    }

    const daily = dailyMap.get(date)!;
    daily.inputTokens += record.inputTokens;
    daily.outputTokens += record.outputTokens;
    daily.totalTokens += record.totalTokens;
    daily.costCents += record.costCents;
    daily.requestCount += 1;
  }

  console.log("getDailyUsage: Grouped into", dailyMap.size, "days");

  // Return only days with data (don't fill in zeros for now)
  return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
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
