import { NextRequest, NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * RFC 7591 — OAuth Dynamic Client Registration.
 * MCP clients register themselves to get a client_id.
 * Since we use public clients with PKCE, no client_secret is issued.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();

  const clientName = body.client_name || "mcp-client";
  const redirectUris: string[] = body.redirect_uris || [];

  // Generate a deterministic client_id from the client name and redirect URIs
  // so the same client gets the same ID on re-registration.
  const clientId = `mcp_${Buffer.from(
    JSON.stringify({ clientName, redirectUris })
  )
    .toString("base64url")
    .slice(0, 32)}`;

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: CORS_HEADERS }
  );
}
