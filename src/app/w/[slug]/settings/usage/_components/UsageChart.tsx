"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { DailyUsage } from "@/lib/actions/token-usage";

interface UsageChartProps {
  data: DailyUsage[];
}

const chartConfig = {
  inputTokens: {
    label: "Input Tokens",
    color: "var(--chart-1)",
  },
  outputTokens: {
    label: "Output Tokens",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export function UsageChart({ data }: UsageChartProps) {
  // Debug: log received data
  console.log("UsageChart received data:", data);
  console.log("Days with tokens:", data.filter((d) => d.totalTokens > 0));

  // Filter to only days with data
  const chartData = data
    .filter((d) => d.totalTokens > 0)
    .map((d) => ({
      date: d.date,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
    }));

  console.log("Filtered chartData:", chartData);

  if (chartData.length === 0) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">No usage data yet</p>
          <p className="text-xs mt-1">
            Token usage will appear here as you use AI features
          </p>
        </div>
      </div>
    );
  }

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-[250px] w-full"
    >
      <BarChart
        accessibilityLayer
        data={chartData}
        margin={{ left: 12, right: 12 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={(value) => {
            const date = new Date(value);
            return date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
          }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="w-[180px]"
              labelFormatter={(value) => {
                return new Date(String(value)).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });
              }}
            />
          }
        />
        <Bar dataKey="inputTokens" fill="var(--color-inputTokens)" radius={4} />
        <Bar dataKey="outputTokens" fill="var(--color-outputTokens)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
