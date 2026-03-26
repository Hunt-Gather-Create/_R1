export type McpErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INTERNAL";

export class McpToolError extends Error {
  code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

export function formatToolError(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (error instanceof McpToolError) {
    return {
      content: [{ type: "text", text: `Error [${error.code}]: ${error.message}` }],
      isError: true,
    };
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
