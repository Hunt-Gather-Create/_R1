"use client";

import { useEffect, useState } from "react";
import { useSettingsContext } from "../context";
import { UsageChart } from "./_components/UsageChart";
import { UsageSummaryCards } from "./_components/UsageSummaryCards";
import { UsageBreakdown } from "./_components/UsageBreakdown";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import {
  getUsageSummary,
  getDailyUsage,
  type UsageSummary,
  type DailyUsage,
} from "@/lib/actions/token-usage";

export default function UsageSettingsPage() {
  const { workspace, brand } = useSettingsContext();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!workspace?.id) return;

    const loadData = async () => {
      setIsLoading(true);
      try {
        const [summaryData, dailyData] = await Promise.all([
          getUsageSummary(workspace.id),
          getDailyUsage(workspace.id, days),
        ]);
        setSummary(summaryData);
        setDailyUsage(dailyData);
      } catch (error) {
        console.error("Failed to load usage data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [workspace?.id, days]);

  const timeRangeSelect = (
    <select
      value={days}
      onChange={(e) => setDays(Number(e.target.value))}
      className="px-3 py-2 bg-background/50 border border-input rounded-md text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value={7}>Last 7 days</option>
      <option value={30}>Last 30 days</option>
      <option value={90}>Last 90 days</option>
    </select>
  );

  if (isLoading) {
    return (
      <GradientPage color={brand?.primaryColor ?? undefined} actions={timeRangeSelect}>
        <PageHeader
          label="Settings"
          title="Usage"
          subtitle="Track AI token usage and costs"
        />
        <section className="container">
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Loading usage data...</p>
            </div>
          </div>
        </section>
      </GradientPage>
    );
  }

  return (
    <GradientPage color={brand?.primaryColor ?? undefined} actions={timeRangeSelect}>
      <PageHeader
        label="Settings"
        title="Usage"
        subtitle="Track AI token usage and costs"
      />

      <section className="container">
        {/* Summary Cards */}
        {summary && <UsageSummaryCards summary={summary} />}

        {/* Usage Chart */}
        <div className="mb-8">
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Token Usage Over Time
            </h2>
            <UsageChart data={dailyUsage} />
          </div>
        </div>

        {/* Breakdown Tables */}
        {summary && <UsageBreakdown summary={summary} />}
      </section>
    </GradientPage>
  );
}
