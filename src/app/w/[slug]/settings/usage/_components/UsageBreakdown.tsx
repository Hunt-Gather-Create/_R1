"use client";

import type { UsageSummary } from "@/lib/actions/token-usage";
import { formatCost, formatTokens, getModelDisplayName } from "@/lib/token-usage";

interface UsageBreakdownProps {
  summary: UsageSummary;
}

function BreakdownTable({
  title,
  data,
  nameFormatter = (s: string) => s,
}: {
  title: string;
  data: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costCents: number;
      requestCount: number;
    }
  >;
  nameFormatter?: (name: string) => string;
}) {
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Requests
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Input
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Output
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Cost
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map(([name, stats]) => (
              <tr key={name} className="hover:bg-muted/50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                  {nameFormatter(name)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground text-right">
                  {stats.requestCount.toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground text-right">
                  {formatTokens(stats.inputTokens)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground text-right">
                  {formatTokens(stats.outputTokens)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground text-right">
                  {formatTokens(stats.totalTokens)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground text-right">
                  {formatCost(stats.costCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatSourceName(source: string): string {
  const names: Record<string, string> = {
    chat: "Chat",
    issue: "Issue Chat",
    planning: "Planning",
    workspace: "Workspace Chat",
    soul: "Persona Config",
    "skill-generation": "Skill Generation",
  };
  return names[source] || source.charAt(0).toUpperCase() + source.slice(1);
}

export function UsageBreakdown({ summary }: UsageBreakdownProps) {
  return (
    <div className="space-y-8">
      <BreakdownTable
        title="Usage by Model"
        data={summary.byModel}
        nameFormatter={getModelDisplayName}
      />
      <BreakdownTable
        title="Usage by Source"
        data={summary.bySource}
        nameFormatter={formatSourceName}
      />
    </div>
  );
}
