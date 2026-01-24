import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export const proxy = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/callback", "/login"],
  },
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
