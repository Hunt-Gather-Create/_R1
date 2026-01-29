"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
    color: "hsl(262, 83%, 58%)", // Purple
  },
  outputTokens: {
    label: "Output Tokens",
    color: "hsl(24, 95%, 53%)", // Orange
  },
} satisfies ChartConfig;

export function UsageChart({ data }: UsageChartProps) {
  // Format data for the chart
  const chartData = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
  }));

  // Check if there's any data
  const hasData = data.some((d) => d.totalTokens > 0);

  if (!hasData) {
    return (
      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
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
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <AreaChart
        accessibilityLayer
        data={chartData}
        margin={{ left: 12, right: 12, top: 12 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={50}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => {
            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
            return value.toString();
          }}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent indicator="dot" />}
        />
        <Area
          dataKey="inputTokens"
          type="natural"
          fill="var(--color-inputTokens)"
          fillOpacity={0.3}
          stroke="var(--color-inputTokens)"
          strokeWidth={2}
          stackId="a"
        />
        <Area
          dataKey="outputTokens"
          type="natural"
          fill="var(--color-outputTokens)"
          fillOpacity={0.3}
          stroke="var(--color-outputTokens)"
          strokeWidth={2}
          stackId="a"
        />
      </AreaChart>
    </ChartContainer>
  );
}
