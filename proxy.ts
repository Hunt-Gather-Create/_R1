import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export const proxy = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [
      "/callback",
      "/login",
      "/runway",                         // Password-gate handles auth (replaces WorkOS per Tim 5/15)
      "/runway/:path*",                  // Password-gate handles auth (replaces WorkOS per Tim 5/15)
      "/api/mcp/runway",                 // Bearer token auth handled in route
      "/api/slack/events",               // Slack signature verification handled in route
      "/api/slack/interactivity",        // Slack signature verification handled in route
      "/api/slack/commands",             // Slack signature verification handled in route
      "/api/slack/options",              // Slack signature verification handled in route
      "/api/runway/gantt-share/:token",  // HMAC token auth handled in route
    ],
  },
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
