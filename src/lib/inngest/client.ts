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
  "runway/slack.message": {
    data: {
      slackUserId: string;
      channelId: string;
      messageText: string;
      messageTs: string;
      threadTs?: string;
      imageFiles?: Array<{ url: string; mimetype: string; name?: string }>;
    };
  };
  // Slack Modal Wave 10: view_submission -> Inngest async write handler.
  // Payload locked per pre-plan v7 §"Wave 10".
  "slack-modal/submit": {
    data: {
      proposalId: string;
      modalCallbackId:
        | "runway_new_task"
        | "runway_new_project"
        | "runway_new_team_member"
        | "runway_edit_task"
        | "runway_edit_project"
        | "runway_edit_team_member";
      stateValues: Record<string, Record<string, unknown>>; // raw view.state.values
      userId: string; // body.user.id
      teamId: string; // body.team.id
      channelId: string; // resolved from proposal row
      threadTs: string | null; // resolved from proposal row
      triggerId: string; // for views.update if needed
      submittedAt: string; // ISO timestamp
    };
  };
};

export const inngest = new Inngest({
  id: "auto-kanban",
  schemas: new EventSchemas().fromRecord<Events>(),
});
