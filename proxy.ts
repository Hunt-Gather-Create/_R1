import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export const proxy = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [
      "/callback",
      "/login",
      "/api/mcp/runway",    // Bearer token auth handled in route
      "/api/slack/events",  // Slack signature verification handled in route
    ],
  },
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
