"use client";

import { useSettingsContext } from "../context";
import { IntegrationRow } from "./_components/IntegrationRow";
import { ServerSearch } from "./_components/ServerSearch";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";

export default function IntegrationsSettingsPage() {
  const { mcpServers, brand } = useSettingsContext();

  return (
    <GradientPage color={brand?.primaryColor ?? undefined}>
      <PageHeader
        label="Settings"
        title="Integrations"
        subtitle="Connect external tools to enhance AI assistant capabilities"
      />

      <section className="container space-y-8">
        {/* Enabled Integrations */}
        {mcpServers.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Enabled Integrations
            </h2>
            <div className="rounded-lg border border-border bg-card">
              {mcpServers.map((server) => (
                <IntegrationRow key={server.key} server={server} />
              ))}
            </div>
          </div>
        )}

        {/* Server Search */}
        <ServerSearch />
      </section>
    </GradientPage>
  );
}
