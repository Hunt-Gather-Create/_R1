import { describe, it, expect } from "vitest";
import {
  MARKETING_PROJECT_TYPES,
  type MarketingProjectType,
} from "./marketing-project-types";

describe("MARKETING_PROJECT_TYPES", () => {
  const allTypes: MarketingProjectType[] = [
    "social-media",
    "email",
    "influencer",
    "pr-communications",
  ];

  it("defines all four project types", () => {
    expect(Object.keys(MARKETING_PROJECT_TYPES)).toEqual(allTypes);
  });

  it.each(allTypes)("%s has required fields", (type) => {
    const config = MARKETING_PROJECT_TYPES[type];
    expect(config.label).toBeTruthy();
    expect(config.description).toBeTruthy();
    expect(config.icon).toBeTruthy();
    expect(config.starterIssues.length).toBeGreaterThanOrEqual(3);
  });

  it.each(allTypes)("%s starter issues have valid status values", (type) => {
    const validStatuses = ["backlog", "todo", "in_progress", "done", "canceled"];
    for (const issue of MARKETING_PROJECT_TYPES[type].starterIssues) {
      expect(validStatuses).toContain(issue.status);
    }
  });

  it.each(allTypes)(
    "%s starter issues have title and description",
    (type) => {
      for (const issue of MARKETING_PROJECT_TYPES[type].starterIssues) {
        expect(issue.title).toBeTruthy();
        expect(issue.description).toBeTruthy();
      }
    }
  );

  it.each(allTypes)("%s has exactly one todo issue as first item", (type) => {
    const issues = MARKETING_PROJECT_TYPES[type].starterIssues;
    expect(issues[0].status).toBe("todo");

    const todoCount = issues.filter((i) => i.status === "todo").length;
    expect(todoCount).toBe(1);
  });
});
