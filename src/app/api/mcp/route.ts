import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMCPServer } from "@/lib/mcp-server";
import { authenticateMCPRequest } from "@/lib/mcp-server/auth/middleware";
import { McpToolError } from "@/lib/mcp-server/errors";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
  // Keep this endpoint non-credentialed: wildcard origins cannot be combined
  // with Access-Control-Allow-Credentials in browsers.
};

function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsJson(body: object, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...init?.headers },
  });
}

/**
 * OPTIONS /api/mcp — CORS preflight.
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/mcp — Handle MCP JSON-RPC messages over Streamable HTTP.
 * Each request is authenticated via Bearer token, then a stateless MCP server
 * is created scoped to the user + workspace from the JWT.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await authenticateMCPRequest(request);
    const server = createMCPServer(ctx);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    await server.connect(transport);

    const response = await transport.handleRequest(request);

    return addCorsHeaders(response);
  } catch (error) {
    if (error instanceof McpToolError) {
      if (error.code === "UNAUTHORIZED") {
        return corsJson(
          { error: "Unauthorized" },
          {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${APP_URL}/.well-known/oauth-protected-resource/api/mcp"`,
            },
          }
        );
      }

      if (error.code === "FORBIDDEN") {
        return corsJson({ error: error.message }, { status: 403 });
      }

      if (error.code === "NOT_FOUND") {
        return corsJson({ error: error.message }, { status: 404 });
      }
    }

    return corsJson({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/mcp — SSE endpoint for server-sent events (notifications).
 * In stateless mode, this returns 405 since there's no persistent session.
 */
export async function GET(): Promise<Response> {
  return corsJson(
    { error: "SSE not supported in stateless mode. Use POST for MCP requests." },
    { status: 405 }
  );
}

/**
 * DELETE /api/mcp — Session cleanup.
 * In stateless mode, this is a no-op.
 */
export async function DELETE(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
