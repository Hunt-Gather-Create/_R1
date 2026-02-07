import { Inngest, EventSchemas } from "inngest";

// Define typed events for compile-time safety
export type Events = {
  "app/hello.world": {
    data: {
      message: string;
      userId?: string;
    };
  };
  "brand/guidelines.research": {
    data: {
      brandId: string;
      brandName: string;
      websiteUrl?: string;
      workspaceId: string;
      metadata?: { description?: string };
    };
  };
  "brand/summary.generate": {
    data: {
      brandId: string;
      brandName: string;
      websiteUrl?: string;
      industry?: string;
      tagline?: string;
      description?: string;
    };
  };
  "ai/task.execute": {
    data: {
      issueId: string; // The subtask to execute
      workspaceId: string; // For loading tools, skills, MCP
      parentIssueId: string; // For attaching output
    };
  };
  "audience/members.generate": {
    data: {
      audienceId: string;
      workspaceId: string;
      brandId: string;
      brandName: string;
      brandIndustry?: string;
      brandGuidelines?: string; // JSON-stringified BrandGuidelines
      generationPrompt: string;
      metadata?: { description?: string };
    };
  };
  "soul/generate": {
    data: {
      workspaceId: string;
      brandId: string;
      brandName: string;
      brandSummary?: string;
      projectType: string;
      workspaceName: string;
    };
  };
};

export const inngest = new Inngest({
  id: "auto-kanban",
  schemas: new EventSchemas().fromRecord<Events>(),
});
