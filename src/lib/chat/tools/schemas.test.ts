import { describe, it, expect } from "vitest";
import {
  planIssueSchema,
  suggestIssueSchema,
  updateDescriptionSchema,
  attachContentSchema,
  listAttachmentsSchema,
  readAttachmentSchema,
  deleteAttachmentSchema,
} from "./schemas";

describe("planIssueSchema", () => {
  describe("valid inputs", () => {
    it("accepts valid issue with all fields", () => {
      const input = {
        title: "Add user authentication",
        description:
          "## Acceptance Criteria\n- [ ] Users can log in\n- [ ] Users can log out",
        priority: 1,
      };

      const result = planIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts priority 0 (Urgent)", () => {
      const input = {
        title: "Fix critical security bug",
        description: "Urgent fix needed",
        priority: 0,
      };

      const result = planIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts priority 4 (None)", () => {
      const input = {
        title: "Backlog item",
        description: "Low priority task",
        priority: 4,
      };

      const result = planIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects missing title", () => {
      const input = {
        description: "Some description",
        priority: 2,
      };

      const result = planIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects priority below 0", () => {
      const input = {
        title: "Some title",
        description: "Some description",
        priority: -1,
      };

      const result = planIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects priority above 4", () => {
      const input = {
        title: "Some title",
        description: "Some description",
        priority: 5,
      };

      const result = planIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

describe("suggestIssueSchema", () => {
  describe("valid inputs", () => {
    it("accepts valid issue suggestion", () => {
      const input = {
        title: "Add dark mode support",
        description:
          "As a user, I want dark mode so that I can reduce eye strain at night",
        priority: 2,
      };

      const result = suggestIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts all priority levels", () => {
      for (let priority = 0; priority <= 4; priority++) {
        const input = {
          title: "Test issue",
          description: "Test description",
          priority,
        };
        const result = suggestIssueSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("invalid inputs", () => {
    it("rejects missing fields", () => {
      expect(suggestIssueSchema.safeParse({}).success).toBe(false);
      expect(
        suggestIssueSchema.safeParse({ title: "Test" }).success
      ).toBe(false);
      expect(
        suggestIssueSchema.safeParse({ title: "Test", description: "Desc" })
          .success
      ).toBe(false);
    });
  });
});

describe("updateDescriptionSchema", () => {
  describe("valid inputs", () => {
    it("accepts a description string", () => {
      const input = { description: "Updated requirements with acceptance criteria" };
      const result = updateDescriptionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts empty description", () => {
      const input = { description: "" };
      const result = updateDescriptionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts markdown description", () => {
      const input = {
        description: `## Acceptance Criteria
- [ ] User can sign up
- [ ] User receives confirmation email
- [ ] User can verify email`,
      };
      const result = updateDescriptionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects missing description", () => {
      const result = updateDescriptionSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string description", () => {
      const result = updateDescriptionSchema.safeParse({ description: 123 });
      expect(result.success).toBe(false);
    });
  });
});

describe("attachContentSchema", () => {
  describe("valid inputs", () => {
    it("accepts content with filename", () => {
      const input = {
        content: "# Guide\n\nThis is a guide.",
        filename: "guide.md",
      };
      const result = attachContentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts content with filename and mimeType", () => {
      const input = {
        content: '{"key": "value"}',
        filename: "data.json",
        mimeType: "application/json",
      };
      const result = attachContentSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("mimeType is optional", () => {
      const input = {
        content: "Plain text content",
        filename: "notes.txt",
      };
      const result = attachContentSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mimeType).toBeUndefined();
      }
    });
  });

  describe("invalid inputs", () => {
    it("rejects missing content", () => {
      const result = attachContentSchema.safeParse({ filename: "test.md" });
      expect(result.success).toBe(false);
    });

    it("rejects missing filename", () => {
      const result = attachContentSchema.safeParse({ content: "test content" });
      expect(result.success).toBe(false);
    });

    it("rejects non-string content", () => {
      const result = attachContentSchema.safeParse({
        content: { data: "test" },
        filename: "test.md",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("listAttachmentsSchema", () => {
  describe("valid inputs", () => {
    it("accepts empty object (defaults includeSubtasks to false)", () => {
      const result = listAttachmentsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeSubtasks).toBe(false);
      }
    });

    it("accepts includeSubtasks: true", () => {
      const result = listAttachmentsSchema.safeParse({ includeSubtasks: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeSubtasks).toBe(true);
      }
    });

    it("accepts includeSubtasks: false", () => {
      const result = listAttachmentsSchema.safeParse({ includeSubtasks: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeSubtasks).toBe(false);
      }
    });
  });

  describe("invalid inputs", () => {
    it("rejects non-boolean includeSubtasks", () => {
      const result = listAttachmentsSchema.safeParse({ includeSubtasks: "yes" });
      expect(result.success).toBe(false);
    });
  });
});

describe("readAttachmentSchema", () => {
  describe("valid inputs", () => {
    it("accepts a valid attachment ID", () => {
      const result = readAttachmentSchema.safeParse({ attachmentId: "abc-123" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.attachmentId).toBe("abc-123");
      }
    });
  });

  describe("invalid inputs", () => {
    it("rejects missing attachmentId", () => {
      const result = readAttachmentSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string attachmentId", () => {
      const result = readAttachmentSchema.safeParse({ attachmentId: 123 });
      expect(result.success).toBe(false);
    });
  });
});

describe("deleteAttachmentSchema", () => {
  describe("valid inputs", () => {
    it("accepts attachmentId with reason", () => {
      const result = deleteAttachmentSchema.safeParse({
        attachmentId: "abc-123",
        reason: "Outdated content",
      });
      expect(result.success).toBe(true);
    });

    it("accepts attachmentId without reason", () => {
      const result = deleteAttachmentSchema.safeParse({ attachmentId: "abc-123" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reason).toBeUndefined();
      }
    });
  });

  describe("invalid inputs", () => {
    it("rejects missing attachmentId", () => {
      const result = deleteAttachmentSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string attachmentId", () => {
      const result = deleteAttachmentSchema.safeParse({ attachmentId: 42 });
      expect(result.success).toBe(false);
    });
  });
});
