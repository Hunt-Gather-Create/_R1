import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export default authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/callback", "/login"],
  },
});

export const config = {
  matcher: [
    // Skip static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
