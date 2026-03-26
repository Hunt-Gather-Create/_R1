import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
} from "@/lib/mcp-server/auth/oauth-provider";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function jsonResponse(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  let params: Record<string, string>;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    params = Object.fromEntries(new URLSearchParams(text));
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        {
          error: "invalid_request",
          error_description: "Request body must be valid JSON",
        },
        400
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse(
        {
          error: "invalid_request",
          error_description: "Request body must be a JSON object",
        },
        400
      );
    }

    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== "string") {
        return jsonResponse(
          {
            error: "invalid_request",
            error_description: `Parameter "${key}" must be a string`,
          },
          400
        );
      }
    }

    params = body as Record<string, string>;
  }

  const grantType = params.grant_type;

  try {
    if (grantType === "authorization_code") {
      const { code, client_id, redirect_uri, code_verifier } = params;

      if (!code || !client_id || !redirect_uri || !code_verifier) {
        return jsonResponse(
          {
            error: "invalid_request",
            error_description:
              "Missing required parameters: code, client_id, redirect_uri, code_verifier",
          },
          400
        );
      }

      const result = await exchangeAuthorizationCode(
        code,
        client_id,
        redirect_uri,
        code_verifier
      );

      return jsonResponse({
        access_token: result.accessToken,
        token_type: "bearer",
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
      });
    }

    if (grantType === "refresh_token") {
      const { refresh_token, client_id } = params;

      if (!refresh_token || !client_id) {
        return jsonResponse(
          {
            error: "invalid_request",
            error_description:
              "Missing required parameters: refresh_token, client_id",
          },
          400
        );
      }

      const result = await refreshAccessToken(refresh_token, client_id);

      return jsonResponse({
        access_token: result.accessToken,
        token_type: "bearer",
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
      });
    }

    return jsonResponse(
      {
        error: "unsupported_grant_type",
        error_description:
          "Supported grant types: authorization_code, refresh_token",
      },
      400
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Token exchange failed";

    return jsonResponse(
      { error: "invalid_grant", error_description: message },
      400
    );
  }
}
