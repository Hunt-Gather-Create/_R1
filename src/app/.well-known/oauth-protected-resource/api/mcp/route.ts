import { NextResponse } from "next/server";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};

/**
 * RFC 9728 — OAuth Protected Resource Metadata (path-aware discovery).
 * The MCP SDK resolves this as: /.well-known/oauth-protected-resource/api/mcp
 */
export async function GET() {
  return NextResponse.json(
    {
      resource: `${APP_URL}/api/mcp`,
      authorization_servers: [`${APP_URL}`],
    },
    { headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
