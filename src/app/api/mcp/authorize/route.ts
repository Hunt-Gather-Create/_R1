import { NextRequest, NextResponse } from "next/server";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { sealData } from "iron-session";

const COOKIE_NAME = "mcp-oauth-params";

function getOAuthCookiePassword(): string | null {
  const password = process.env.WORKOS_COOKIE_PASSWORD;
  return password && password.length >= 32 ? password : null;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const cookiePassword = getOAuthCookiePassword();

  if (!cookiePassword) {
    return NextResponse.json(
      {
        error: "server_error",
        error_description:
          "MCP OAuth cookie secret is not configured. Set WORKOS_COOKIE_PASSWORD to a value with at least 32 characters.",
      },
      { status: 500 }
    );
  }

  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");

  // Validate required params
  if (responseType !== "code") {
    return NextResponse.json(
      { error: "unsupported_response_type", error_description: "Only response_type=code is supported" },
      { status: 400 }
    );
  }

  if (!clientId || !redirectUri || !state || !codeChallenge) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters: client_id, redirect_uri, state, code_challenge" },
      { status: 400 }
    );
  }

  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Only code_challenge_method=S256 is supported" },
      { status: 400 }
    );
  }

  // Seal OAuth params in a cookie for the callback to read
  const oauthParams = {
    clientId,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod: codeChallengeMethod || "S256",
  };

  const sealed = await sealData(oauthParams, { password: cookiePassword });

  // Redirect to WorkOS sign-in with returnPathname encoded in state
  // so handleAuth() redirects back to our MCP callback after login.
  const returnState = btoa(JSON.stringify({ returnPathname: "/api/mcp/callback" }));

  const signInUrl = await getSignInUrl({ state: returnState });

  const response = NextResponse.redirect(signInUrl);

  // Store OAuth params in a secure cookie
  response.cookies.set(COOKIE_NAME, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
