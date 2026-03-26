import { NextResponse } from "next/server";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

/**
 * RFC 9728 — OAuth Protected Resource Metadata.
 * MCP clients discover this endpoint first, then follow the
 * authorization_servers link to get the full OAuth server metadata.
 */
export async function GET() {
  return NextResponse.json({
    resource: `${APP_URL}/api/mcp`,
    authorization_servers: [
      `${APP_URL}/api/mcp/.well-known/oauth-authorization-server`,
    ],
  });
}
