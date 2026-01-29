"use client";

import { Coins, Zap, ArrowUpRight, ArrowDownLeft, Database, RefreshCw } from "lucide-react";
import type { UsageSummary } from "@/lib/actions/token-usage";
import { formatCost, formatTokens } from "@/lib/token-usage-formatters";

interface UsageSummaryCardsProps {
  summary: UsageSummary;
}

export function UsageSummaryCards({ summary }: UsageSummaryCardsProps) {
  const hasCacheData =
    summary.totalCacheCreationTokens > 0 || summary.totalCacheReadTokens > 0;

  const cards = [
    {
      label: "Total Cost",
      value: formatCost(summary.totalCostCents),
      icon: Coins,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      label: "Total Tokens",
      value: formatTokens(summary.totalTokens),
      icon: Zap,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      label: "Input Tokens",
      value: formatTokens(summary.totalInputTokens),
      icon: ArrowUpRight,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      label: "Output Tokens",
      value: formatTokens(summary.totalOutputTokens),
      icon: ArrowDownLeft,
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
    },
  ];

  const cacheCards = [
    {
      label: "Cache Writes",
      value: formatTokens(summary.totalCacheCreationTokens),
      subtitle: "1.25x input price",
      icon: Database,
      color: "text-cyan-500",
      bgColor: "bg-cyan-500/10",
    },
    {
      label: "Cache Reads",
      value: formatTokens(summary.totalCacheReadTokens),
      subtitle: "90% savings",
      icon: RefreshCw,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
  ];

  return (
    <div className="space-y-4 mb-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-md ${card.bgColor}`}>
                <card.icon className={`w-4 h-4 ${card.color}`} />
              </div>
              <span className="text-xs text-muted-foreground">{card.label}</span>
            </div>
            <div className="text-2xl font-bold text-foreground">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Cache Stats - only show if there's cache data */}
      {hasCacheData && (
        <div className="grid grid-cols-2 gap-4">
          {cacheCards.map((card) => (
            <div
              key={card.label}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-md ${card.bgColor}`}>
                  <card.icon className={`w-4 h-4 ${card.color}`} />
                </div>
                <span className="text-xs text-muted-foreground">{card.label}</span>
              </div>
              <div className="text-2xl font-bold text-foreground">{card.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{card.subtitle}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
