"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
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
  // Format data for the chart
  const chartData = data.map((d) => ({
    date: d.date,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
  }));

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
      <BarChart accessibilityLayer data={chartData}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tickFormatter={(value) => {
            const date = new Date(value);
            return date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
          }}
          interval="preserveStartEnd"
          minTickGap={40}
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
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="inputTokens"
          stackId="a"
          fill="var(--color-inputTokens)"
          radius={[0, 0, 4, 4]}
        />
        <Bar
          dataKey="outputTokens"
          stackId="a"
          fill="var(--color-outputTokens)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}
