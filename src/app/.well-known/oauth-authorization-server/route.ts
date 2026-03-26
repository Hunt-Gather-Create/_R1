import { NextResponse } from "next/server";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};

/**
 * RFC 8414 — OAuth Authorization Server Metadata.
 * Discovered by MCP clients via the issuer URL from the protected resource metadata.
 */
export async function GET() {
  return NextResponse.json(
    {
      issuer: APP_URL,
      authorization_endpoint: `${APP_URL}/api/mcp/authorize`,
      token_endpoint: `${APP_URL}/api/mcp/token`,
      registration_endpoint: `${APP_URL}/api/mcp/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
