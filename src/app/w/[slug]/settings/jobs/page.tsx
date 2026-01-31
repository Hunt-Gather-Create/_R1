"use client";

import { RefreshCw } from "lucide-react";
import { useSettingsContext } from "../context";
import { useWorkspaceJobs, useInvalidateSettings } from "@/lib/hooks/use-settings-queries";
import { GradientPage } from "@/components/ui/gradient-page";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { JobsDataTable } from "./_components/JobsDataTable";

export default function JobsSettingsPage() {
  const { workspace, brand } = useSettingsContext();
  const { invalidateJobs } = useInvalidateSettings();

  const {
    data: jobs = [],
    isLoading,
    isFetching,
  } = useWorkspaceJobs(workspace?.id ?? null);

  const handleRefresh = () => {
    if (workspace?.id) {
      invalidateJobs(workspace.id);
    }
  };

  const refreshButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      disabled={isFetching}
    >
      <RefreshCw className={isFetching ? "animate-spin" : ""} />
      Refresh
    </Button>
  );

  return (
    <GradientPage color={brand?.primaryColor ?? undefined} actions={refreshButton}>
      <PageHeader
        label="Settings"
        title="Background Jobs"
        subtitle="Monitor and track background job execution"
      />

      <section className="container">
        <JobsDataTable data={jobs} isLoading={isLoading} />
      </section>
    </GradientPage>
  );
}
