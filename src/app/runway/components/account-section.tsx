"use client";

import { useMemo } from "react";
import type { Account } from "../types";
import { StatusBadge, StaleBadge, ContractBadge } from "./status-badge";

export function AccountSection({ account }: { account: Account }) {
  const activeItems = useMemo(
    () =>
      account.items.filter(
        (i) => i.category === "active" || i.category === "awaiting-client"
      ),
    [account.items]
  );

  const holdItems = useMemo(
    () => account.items.filter((i) => i.category === "on-hold"),
    [account.items]
  );

  return (
    <div className="rounded-xl border border-border bg-card/30 p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-xl font-bold text-foreground">{account.name}</h3>
          {account.team ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {account.team}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-foreground">
            {account.contractValue}
          </p>
          <p className="text-xs text-muted-foreground">
            {account.contractTerm}
          </p>
          <ContractBadge status={account.contractStatus} />
        </div>
      </div>

      <div className="space-y-2">
        {activeItems.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 rounded-lg border border-border/50 bg-background/50 p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground/50">
                  {item.id}
                </span>
                <StatusBadge status={item.status} />
                {item.staleDays ? <StaleBadge days={item.staleDays} /> : null}
              </div>
              <p className="mt-1 text-sm font-medium text-foreground">
                {item.title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {item.owner ? (
                  <span className="text-xs text-muted-foreground">
                    Owner: {item.owner}
                  </span>
                ) : null}
                {item.waitingOn ? (
                  <span className="text-xs text-amber-400/80">
                    Waiting on: {item.waitingOn}
                  </span>
                ) : null}
                {item.target ? (
                  <span className="text-xs text-sky-400/80">
                    Target: {item.target}
                  </span>
                ) : null}
              </div>
              {item.notes ? (
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {item.notes}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {holdItems.length > 0 ? (
        <div className="mt-3 border-t border-border/30 pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/50">
            On Hold
          </p>
          {holdItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground/60"
            >
              <span className="font-mono">{item.id}</span>
              <span>{item.title}</span>
              {item.notes ? <span>— {item.notes}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
