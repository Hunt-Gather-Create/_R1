/**
 * Runway MCP Server — HTTP endpoint
 *
 * POST /api/mcp/runway — MCP protocol messages (Streamable HTTP transport)
 * Auth: Bearer token via RUNWAY_MCP_API_KEY env var
 */

import { createRunwayMcpServer } from "@/lib/mcp/runway-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest } from "next/server";

function validateAuth(request: NextRequest): boolean {
  const apiKey = process.env.RUNWAY_MCP_API_KEY;
  if (!apiKey) {
    throw new Error("RUNWAY_MCP_API_KEY is not configured");
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.slice(7);
  return token === apiKey;
}

export async function POST(request: NextRequest) {
  try {
    if (!validateAuth(request)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const server = createRunwayMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  await server.connect(transport);

  const body = await request.json();
  return transport.handleRequest(request, { parsedBody: body });
}

export async function GET() {
  return new Response(JSON.stringify({ error: "Method not allowed. Use POST for MCP protocol." }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}

export async function DELETE() {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
