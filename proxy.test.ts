import { describe, it, expect, vi } from "vitest";

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: vi.fn().mockReturnValue(() => {}),
}));

import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

describe("proxy middleware", () => {
  it("exports proxy and config", async () => {
    const mod = await import("./proxy");
    expect(mod.proxy).toBeDefined();
    expect(mod.config).toBeDefined();
  });

  it("calls authkitMiddleware with enabled auth", async () => {
    await import("./proxy");
    expect(authkitMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        middlewareAuth: expect.objectContaining({
          enabled: true,
        }),
      })
    );
  });

  it("excludes Runway MCP and Slack endpoints from auth", async () => {
    await import("./proxy");
    const call = vi.mocked(authkitMiddleware).mock.calls[0][0];
    const paths = call.middlewareAuth.unauthenticatedPaths;
    expect(paths).toContain("/api/mcp/runway");
    expect(paths).toContain("/api/slack/events");
  });

  it("excludes callback and login from auth", async () => {
    await import("./proxy");
    const call = vi.mocked(authkitMiddleware).mock.calls[0][0];
    const paths = call.middlewareAuth.unauthenticatedPaths;
    expect(paths).toContain("/callback");
    expect(paths).toContain("/login");
  });

  it("has a matcher that excludes static files", async () => {
    const mod = await import("./proxy");
    expect(mod.config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico|public/).*)",
    ]);
  });
});
