import { NextRequest, NextResponse } from "next/server";
import { unsealData } from "iron-session";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createAuthorizationCode } from "@/lib/mcp-server/auth/oauth-provider";

const COOKIE_NAME = "mcp-oauth-params";
const WORKOS_COOKIE_NAME = process.env.WORKOS_COOKIE_NAME || "wos-session";
const WORKOS_COOKIE_PASSWORD = process.env.WORKOS_COOKIE_PASSWORD || "";

function getOAuthCookiePassword(): string | null {
  const password = process.env.WORKOS_COOKIE_PASSWORD;
  return password && password.length >= 32 ? password : null;
}

interface WorkOSSession {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    profilePictureUrl: string | null;
  };
}

interface OAuthParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

/**
 * GET /api/mcp/callback
 *
 * After WorkOS authenticates the user, this callback:
 * 1. Reads the WorkOS session to identify the user
 * 2. Reads the stored OAuth params
 * 3. Shows a workspace picker (single selection) or auto-selects
 * 4. Creates an authorization code and redirects back to the MCP client
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const cookiePassword = getOAuthCookiePassword();

  if (!cookiePassword) {
    return new NextResponse(
      "Server misconfiguration: MCP OAuth cookie secret is missing or too short",
      { status: 500 }
    );
  }

  // Read WorkOS session
  const wosCookie = cookieStore.get(WORKOS_COOKIE_NAME);
  if (!wosCookie?.value) {
    return new NextResponse("Authentication failed: no session found", {
      status: 401,
    });
  }

  let session: WorkOSSession;
  try {
    session = await unsealData<WorkOSSession>(wosCookie.value, {
      password: WORKOS_COOKIE_PASSWORD,
    });
  } catch {
    return new NextResponse("Authentication failed: invalid session", {
      status: 401,
    });
  }

  // Read stored OAuth params
  const oauthCookie = cookieStore.get(COOKIE_NAME);
  if (!oauthCookie?.value) {
    return new NextResponse("OAuth flow expired: missing parameters", {
      status: 400,
    });
  }

  let oauthParams: OAuthParams;
  try {
    oauthParams = await unsealData<OAuthParams>(oauthCookie.value, {
      password: cookiePassword,
    });
  } catch {
    return new NextResponse("OAuth flow expired: invalid parameters", {
      status: 400,
    });
  }

  // Check if this is a workspace selection submission
  const selectedWorkspace = request.nextUrl.searchParams.get("workspace");

  // Get user's workspaces
  const memberships = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      workspacePurpose: workspaces.purpose,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, session.user.id));

  if (selectedWorkspace) {
    const hasWorkspaceAccess = memberships.some(
      (membership) => membership.workspaceId === selectedWorkspace
    );

    if (!hasWorkspaceAccess) {
      return new NextResponse("Access denied", { status: 403 });
    }

    // User has selected a workspace — create auth code and redirect
    const code = await createAuthorizationCode(
      session.user.id,
      selectedWorkspace,
      oauthParams.clientId,
      oauthParams.redirectUri,
      oauthParams.codeChallenge,
      oauthParams.codeChallengeMethod
    );

    const redirectUrl = new URL(oauthParams.redirectUri);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", oauthParams.state);

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(COOKIE_NAME);
    return response;
  }

  if (memberships.length === 0) {
    // No workspaces — grant user-level access only (workspaceId = null)
    const code = await createAuthorizationCode(
      session.user.id,
      null,
      oauthParams.clientId,
      oauthParams.redirectUri,
      oauthParams.codeChallenge,
      oauthParams.codeChallengeMethod
    );

    const redirectUrl = new URL(oauthParams.redirectUri);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", oauthParams.state);

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(COOKIE_NAME);
    return response;
  }

  if (memberships.length === 1) {
    // Single workspace — auto-select
    const code = await createAuthorizationCode(
      session.user.id,
      memberships[0].workspaceId,
      oauthParams.clientId,
      oauthParams.redirectUri,
      oauthParams.codeChallenge,
      oauthParams.codeChallengeMethod
    );

    const redirectUrl = new URL(oauthParams.redirectUri);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", oauthParams.state);

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(COOKIE_NAME);
    return response;
  }

  // Multiple workspaces — render a picker page with radio buttons (single selection)
  const callbackUrl = request.nextUrl.pathname;
  const userName = session.user.firstName || session.user.email;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Select Workspace — Insight MCP</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #171717; border: 1px solid #262626; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .subtitle { color: #a3a3a3; font-size: 14px; margin-bottom: 24px; }
    .workspace-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
    .workspace { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #262626; border-radius: 8px; cursor: pointer; }
    .workspace:hover { border-color: #404040; }
    .workspace.selected { border-color: #3b82f6; background: #172554; }
    .workspace input { accent-color: #3b82f6; }
    .workspace-info { flex: 1; }
    .workspace-name { font-size: 14px; font-weight: 500; }
    .workspace-meta { font-size: 12px; color: #737373; }
    .btn { display: block; width: 100%; padding: 10px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; background: #3b82f6; color: white; }
    .btn:hover { background: #2563eb; }
    .btn:disabled { background: #1e3a5f; color: #6b7280; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Select Workspace</h1>
    <p class="subtitle">Hi ${escapeHtml(userName)}, choose which workspace this MCP client will access.</p>

    <div class="workspace-list" id="workspaceList">
      ${memberships
        .map(
          (m) => `
        <label class="workspace" onclick="selectWorkspace(this)">
          <input type="radio" name="workspace" value="${escapeHtml(m.workspaceId)}" onchange="updateButton()">
          <div class="workspace-info">
            <div class="workspace-name">${escapeHtml(m.workspaceName)}</div>
            <div class="workspace-meta">${escapeHtml(m.workspacePurpose)} · ${escapeHtml(m.role)}</div>
          </div>
        </label>`
        )
        .join("")}
    </div>

    <button class="btn" id="submitBtn" onclick="submit()" disabled>Continue</button>
  </div>

  <script>
    function selectWorkspace(label) {
      document.querySelectorAll('.workspace').forEach(el => el.classList.remove('selected'));
      label.classList.add('selected');
    }

    function updateButton() {
      const selected = document.querySelector('input[name="workspace"]:checked');
      document.getElementById('submitBtn').disabled = !selected;
    }

    function submit() {
      const selected = document.querySelector('input[name="workspace"]:checked');
      if (selected) {
        window.location.href = '${callbackUrl}?workspace=' + selected.value;
      }
    }
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
