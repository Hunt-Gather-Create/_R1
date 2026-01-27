import { describe, it, expect } from "vitest";
import { parseTextWithFileAttachments } from "./CollapsibleFileContent";

describe("parseTextWithFileAttachments", () => {
  it("parses text with no file attachments", () => {
    const text = "Hello, this is a message";
    const result = parseTextWithFileAttachments(text);

    expect(result.mainText).toBe("Hello, this is a message");
    expect(result.filesSections).toHaveLength(0);
  });

  it("parses text with a single file attachment", () => {
    const text = `Hello, check this file

--- readme.md ---
# Title
Some content here`;

    const result = parseTextWithFileAttachments(text);

    expect(result.mainText).toBe("Hello, check this file");
    expect(result.filesSections).toHaveLength(1);
    expect(result.filesSections[0].filename).toBe("readme.md");
    expect(result.filesSections[0].content).toBe("# Title\nSome content here");
  });

  it("parses text with multiple file attachments", () => {
    const text = `Review these files

--- file1.txt ---
Content of file 1

--- file2.json ---
{"key": "value"}`;

    const result = parseTextWithFileAttachments(text);

    expect(result.mainText).toBe("Review these files");
    expect(result.filesSections).toHaveLength(2);
    expect(result.filesSections[0].filename).toBe("file1.txt");
    expect(result.filesSections[0].content).toBe("Content of file 1");
    expect(result.filesSections[1].filename).toBe("file2.json");
    expect(result.filesSections[1].content).toBe('{"key": "value"}');
  });

  it("handles file attachments with no main text", () => {
    const text = `

--- config.yaml ---
key: value
nested:
  item: 1`;

    const result = parseTextWithFileAttachments(text);

    expect(result.mainText).toBe("");
    expect(result.filesSections).toHaveLength(1);
    expect(result.filesSections[0].filename).toBe("config.yaml");
  });

  it("handles filenames with spaces", () => {
    const text = `Check this

--- my document.txt ---
Document content`;

    const result = parseTextWithFileAttachments(text);

    expect(result.filesSections).toHaveLength(1);
    expect(result.filesSections[0].filename).toBe("my document.txt");
  });

  it("handles filenames with special characters", () => {
    const text = `Files

--- test-file_v2.0.txt ---
Version 2 content`;

    const result = parseTextWithFileAttachments(text);

    expect(result.filesSections).toHaveLength(1);
    expect(result.filesSections[0].filename).toBe("test-file_v2.0.txt");
  });

  it("preserves multiline content in files", () => {
    const text = `Code file

--- script.js ---
function hello() {
  console.log("Hello");
}

export default hello;`;

    const result = parseTextWithFileAttachments(text);

    expect(result.filesSections[0].content).toContain("function hello()");
    expect(result.filesSections[0].content).toContain("export default hello;");
  });

  it("handles empty file content", () => {
    const text = `Empty file

--- empty.txt ---
`;

    const result = parseTextWithFileAttachments(text);

    expect(result.filesSections).toHaveLength(1);
    expect(result.filesSections[0].filename).toBe("empty.txt");
    expect(result.filesSections[0].content).toBe("");
  });
});
