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
  "ai/task.execute": {
    data: {
      issueId: string; // The subtask to execute
      workspaceId: string; // For loading tools, skills, MCP
      parentIssueId: string; // For attaching output
    };
  };
};

export const inngest = new Inngest({
  id: "auto-kanban",
  schemas: new EventSchemas().fromRecord<Events>(),
});
