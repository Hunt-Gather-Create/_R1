import { describe, it, expect } from "vitest";
import {
  SUPPORTED_ATTACHMENT_TYPES,
  isSupportedAttachmentType,
  fileToDataUrl,
  prepareFilesForSubmission,
} from "./file-utils";

describe("file-utils", () => {
  describe("SUPPORTED_ATTACHMENT_TYPES", () => {
    it("includes common image types", () => {
      expect(SUPPORTED_ATTACHMENT_TYPES).toContain("image/jpeg");
      expect(SUPPORTED_ATTACHMENT_TYPES).toContain("image/png");
      expect(SUPPORTED_ATTACHMENT_TYPES).toContain("image/gif");
      expect(SUPPORTED_ATTACHMENT_TYPES).toContain("image/webp");
    });

    it("includes PDF", () => {
      expect(SUPPORTED_ATTACHMENT_TYPES).toContain("application/pdf");
    });
  });

  describe("isSupportedAttachmentType", () => {
    it("returns true for supported image types", () => {
      expect(isSupportedAttachmentType("image/jpeg")).toBe(true);
      expect(isSupportedAttachmentType("image/png")).toBe(true);
      expect(isSupportedAttachmentType("image/gif")).toBe(true);
      expect(isSupportedAttachmentType("image/webp")).toBe(true);
    });

    it("returns true for PDF", () => {
      expect(isSupportedAttachmentType("application/pdf")).toBe(true);
    });

    it("returns false for text types", () => {
      expect(isSupportedAttachmentType("text/plain")).toBe(false);
      expect(isSupportedAttachmentType("text/markdown")).toBe(false);
      expect(isSupportedAttachmentType("text/csv")).toBe(false);
    });

    it("returns false for other application types", () => {
      expect(isSupportedAttachmentType("application/json")).toBe(false);
      expect(isSupportedAttachmentType("application/xml")).toBe(false);
    });
  });

  describe("fileToDataUrl", () => {
    it("converts a text file to data URL", async () => {
      const content = "Hello, world!";
      const file = new File([content], "test.txt", { type: "text/plain" });

      const dataUrl = await fileToDataUrl(file);

      expect(dataUrl).toMatch(/^data:text\/plain;base64,/);
    });

    it("converts an image file to data URL", async () => {
      // Create a simple 1x1 pixel PNG
      const pngData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const file = new File([pngData], "test.png", { type: "image/png" });

      const dataUrl = await fileToDataUrl(file);

      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe("prepareFilesForSubmission", () => {
    it("separates image files from text files", async () => {
      const imageFile = new File(["image"], "photo.png", { type: "image/png" });
      const textFile = new File(["content"], "doc.txt", { type: "text/plain" });

      const result = await prepareFilesForSubmission(
        [imageFile, textFile],
        "Hello"
      );

      // Image should be in attachments
      expect(result.fileAttachments).toHaveLength(1);
      expect(result.fileAttachments[0].filename).toBe("photo.png");
      expect(result.fileAttachments[0].type).toBe("file");

      // Text content should be appended to message
      expect(result.messageText).toContain("Hello");
      expect(result.messageText).toContain("--- doc.txt ---");
      expect(result.messageText).toContain("content");
    });

    it("handles only image files", async () => {
      const imageFile = new File(["image"], "photo.jpg", { type: "image/jpeg" });

      const result = await prepareFilesForSubmission([imageFile], "Check this");

      expect(result.fileAttachments).toHaveLength(1);
      expect(result.fileAttachments[0].filename).toBe("photo.jpg");
      expect(result.messageText).toBe("Check this");
    });

    it("handles only text files", async () => {
      const textFile = new File(["markdown content"], "readme.md", {
        type: "text/markdown",
      });

      const result = await prepareFilesForSubmission(
        [textFile],
        "Review this"
      );

      expect(result.fileAttachments).toHaveLength(0);
      expect(result.messageText).toContain("Review this");
      expect(result.messageText).toContain("--- readme.md ---");
      expect(result.messageText).toContain("markdown content");
    });

    it("handles empty file array", async () => {
      const result = await prepareFilesForSubmission([], "Just text");

      expect(result.fileAttachments).toHaveLength(0);
      expect(result.messageText).toBe("Just text");
    });

    it("handles PDF as attachment", async () => {
      const pdfFile = new File(["pdf content"], "document.pdf", {
        type: "application/pdf",
      });

      const result = await prepareFilesForSubmission([pdfFile], "See PDF");

      expect(result.fileAttachments).toHaveLength(1);
      expect(result.fileAttachments[0].filename).toBe("document.pdf");
      expect(result.fileAttachments[0].mediaType).toBe("application/pdf");
    });

    it("handles multiple text files", async () => {
      const file1 = new File(["content 1"], "file1.txt", { type: "text/plain" });
      const file2 = new File(["content 2"], "file2.txt", { type: "text/plain" });

      const result = await prepareFilesForSubmission([file1, file2], "Files");

      expect(result.fileAttachments).toHaveLength(0);
      expect(result.messageText).toContain("--- file1.txt ---");
      expect(result.messageText).toContain("content 1");
      expect(result.messageText).toContain("--- file2.txt ---");
      expect(result.messageText).toContain("content 2");
    });
  });
});
